"""简历优化网站 · 后端（FastAPI，包引擎全能力）。

核心链路本地版：上传/粘贴 → 结构化 → JD 匹配 → 针对弱项改写(diff) → 逐条接受 → 评分 →
渲染 Kami HTML（浏览器打印成 PDF）。部署/队列/账号/合规后置。

慢任务语义（Codex 复核）：重活路由用 `def`（Starlette 走线程池，不堵事件循环）；ingest 因
需 await 文件读取用 async + run_in_threadpool。前端「停止等待」只断浏览器等待，不终止推理。

运行（DeepSeek 托管，推荐；质量远强于本地 gemma4）：
    cd resume_agent/webapp
    export LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-...
    uvicorn app:app --reload --port 8000

或本地兜底（免费、慢）：
    OLLAMA_MODEL=gemma4:latest uvicorn app:app --reload --port 8000
"""

from __future__ import annotations

import copy
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, UploadFile, File, Form, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ENGINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE))

import ingest as ingest_mod
import jd_match as jm
import kami_adapter
import evaluate as ev_mod
import rubrics
import role_detect
from improver import total_score, max_total, fact_gap_report
from patcher import improve_via_patch
from resume_diff import diff_resume
from validate import validate_resume
from llm import make_chat_fn, make_vision_ocr_fn, LLMConfigError
from db import get_repo, NotFound as RepoNotFound, Conflict as RepoConflict

app = FastAPI(title="Resume Agent")


def chat():
    """按 LLM_PROVIDER（env）构造 chat_fn。ollama 兜底时用 gemma4:latest（比默认 gemma3:4b 强）；
    deepseek/openai/gemini 由各自 env（key/base_url/model）驱动。"""
    prov = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if prov == "ollama":
        return make_chat_fn(os.getenv("OLLAMA_MODEL", "gemma4:latest"))
    return make_chat_fn()


def vision_ocr():
    """构造视觉 OCR（扫描件/图片简历用）。未配 QWEN_API_KEY 时返回 None（可插拔，不阻塞文本管线）。"""
    try:
        return make_vision_ocr_fn()
    except LLMConfigError:
        return None


# --------------------------------------------------------------------------- #
# 结构化错误 + requestId
# --------------------------------------------------------------------------- #
class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400,
                 retryable: bool = False, field_errors: Optional[Dict] = None):
        self.code, self.message, self.status = code, message, status
        self.retryable, self.field_errors = retryable, field_errors or {}


@app.middleware("http")
async def _rid(request: Request, call_next):
    request.state.rid = uuid.uuid4().hex[:12]
    resp = await call_next(request)
    resp.headers["X-Request-Id"] = request.state.rid
    return resp


def _envelope(request: Request, code, message, retryable=False, field_errors=None):
    return {"code": code, "message": " ".join(str(message).split())[:300],  # 截断，防大段 HTML
            "retryable": retryable,
            "requestId": getattr(request.state, "rid", None), "fieldErrors": field_errors or {}}


@app.exception_handler(ApiError)
async def _h_api(request: Request, exc: ApiError):
    return JSONResponse(
        status_code=exc.status,
        content=_envelope(request, exc.code, exc.message, exc.retryable, exc.field_errors))


@app.exception_handler(LLMConfigError)
async def _h_llm(request: Request, exc: LLMConfigError):
    return JSONResponse(
        status_code=503, content=_envelope(request, "LLM_UNAVAILABLE", str(exc), retryable=True))


@app.exception_handler(RepoNotFound)
async def _h_notfound(request: Request, exc: RepoNotFound):
    return JSONResponse(status_code=404, content=_envelope(request, "NOT_FOUND", str(exc)))


@app.exception_handler(RepoConflict)
async def _h_conflict(request: Request, exc: RepoConflict):
    return JSONResponse(status_code=409, content=_envelope(request, "VERSION_CONFLICT", str(exc), retryable=True))


@app.exception_handler(Exception)
async def _h_any(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500, content=_envelope(request, "SERVER_ERROR", str(exc), retryable=True))


# --------------------------------------------------------------------------- #
# 点路径读写（用于安全 diff 写回）
# --------------------------------------------------------------------------- #
_TOK = re.compile(r"\.?([A-Za-z_]\w*)|\[(\d+)\]")


def _keys(path: str):
    return [name if name is not None else int(idx)
            for name, idx in ((m.group(1), m.group(2)) for m in _TOK.finditer(path))]


def get_by_path(obj: Any, path: str):
    cur = obj
    try:
        for k in _keys(path):
            cur = cur[k]
        return cur
    except (KeyError, IndexError, TypeError):
        return None


def set_by_path(obj: Any, path: str, value: Any) -> bool:
    keys = _keys(path)
    if not keys:
        return False
    cur = obj
    try:
        for k in keys[:-1]:
            cur = cur[k]
        cur[keys[-1]] = value
        return True
    except (KeyError, IndexError, TypeError):
        return False


def _report_dict(r: jm.MatchReport) -> Dict[str, Any]:
    return {"requirements": r.requirements, "matches": r.matches,
            "summary": r.summary, "warnings": r.warnings}


def _warns(ws: List[str]) -> List[Dict[str, str]]:
    return [{"severity": "warn", "message": w} for w in ws]


# --------------------------------------------------------------------------- #
# 请求模型
# --------------------------------------------------------------------------- #
class MatchReq(BaseModel):
    resume: Dict[str, Any]
    jd: str


class Patch(BaseModel):
    op: str = "replace"
    path: str
    old: Optional[str] = None
    value: Any = None


class ApplyReq(BaseModel):
    resume: Dict[str, Any]
    baseRevision: Optional[str] = None
    patches: List[Patch]


class EvalReq(BaseModel):
    resume: Dict[str, Any]
    role: str = "designer"


class RenderReq(BaseModel):
    resume: Dict[str, Any]
    lang: str = "zh"
    role: Optional[str] = None


class DetectRoleReq(BaseModel):
    resume: Optional[Dict[str, Any]] = None
    jd: str = ""                       # 有 JD 以 JD 推断为准


class AutoImproveReq(BaseModel):
    resume: Dict[str, Any]
    role: str = "engineer"


class ResumeCreateReq(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None
    jd: str = ""
    data: Optional[Dict[str, Any]] = None
    export_md: Optional[str] = None


class ResumeUpdateReq(BaseModel):
    version: int                       # 乐观并发：必带
    title: Optional[str] = None
    role: Optional[str] = None
    jd: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    export_md: Optional[str] = None
    note: str = "修改前"
    fields: Optional[List[str]] = None  # 显式声明本次要改的字段（区分「设为 None」与「不改」）


class RollbackReq(BaseModel):
    revisionId: str
    version: int


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
_ALLOWED_UPLOAD_EXTS = (".pdf",) + ingest_mod.IMAGE_EXTS


@app.post("/api/ingest")
async def api_ingest(request: Request, file: Optional[UploadFile] = File(None), text: str = Form("")):
    used_ocr = False
    if file is not None:
        import tempfile
        ext = Path(file.filename or "").suffix.lower()
        if ext not in _ALLOWED_UPLOAD_EXTS:
            ext = ".pdf"  # 无/未知后缀按 PDF 处理（扫描件仍会回退 OCR）
        data = await file.read()
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
            tf.write(data)
            tmp = tf.name

        ocr_fn = vision_ocr()  # 未配 QWEN_API_KEY 则为 None，图片/扫描件会明确报错

        def work():
            try:
                return ingest_mod.source_to_text(tmp, ocr_fn=ocr_fn)  # (文本, 是否 OCR)
            finally:
                os.unlink(tmp)
        try:
            src_text, used_ocr = await run_in_threadpool(work)
        except ValueError as e:
            raise ApiError("INGEST_FAILED", str(e), retryable=False)
    elif text.strip():
        src_text = text
    else:
        raise ApiError("NO_INPUT", "请上传 PDF / 图片或粘贴文本")
    try:
        resume = await run_in_threadpool(ingest_mod.text_to_resume, src_text, chat())
    except ValueError as e:
        raise ApiError("INGEST_FAILED", f"结构化失败：{e}", retryable=True)
    warns = ingest_mod.grounding_warnings(resume, src_text)
    if used_ocr:  # OCR 可能丢字/串行，提示重点核对
        warns = ["本简历经图片 OCR 识别，个别文字可能有误，请在下一步逐项核对。"] + warns
    return {"resume": resume, "warnings": _warns(warns), "usedOcr": used_ocr}


@app.post("/api/validate")
def api_validate(resume: Dict[str, Any]):
    return {"errors": validate_resume(resume)}


@app.post("/api/match")
def api_match(req: MatchReq):
    try:
        return _report_dict(jm.jd_match(req.jd, req.resume, chat()))
    except ValueError as e:
        raise ApiError("MATCH_FAILED", f"匹配失败：{e}", retryable=True)


@app.post("/api/improve")
def api_improve(req: MatchReq):
    try:
        before, improved, imp = jm.match_and_improve(req.jd, req.resume, chat())
    except ValueError as e:
        raise ApiError("IMPROVE_FAILED", f"改写失败：{e}", retryable=True)
    changes = [{"kind": c.kind, "path": c.path, "old": c.old, "new": c.new}
               for c in diff_resume(req.resume, improved)]
    return {"before": _report_dict(before), "changes": changes,
            "notes": imp.notes, "must_supplements": imp.must_supplements}


@app.post("/api/detect-role")
def api_detect_role(req: DetectRoleReq):
    """自动检测岗位方向：有 JD 以 JD 为准，否则用简历文本。返回 rubric key + 中文标签。"""
    if req.jd.strip():
        text = req.jd
    elif req.resume:
        text = ev_mod.resume_to_text(req.resume)  # 已脱敏（无姓名/院校/城市）
    else:
        raise ApiError("NO_INPUT", "请提供简历或 JD 以检测岗位")
    role = role_detect.detect_role(text, chat())
    return {"role": role, "label": rubrics.get_rubric(role).role}


@app.post("/api/auto-improve")
def api_auto_improve(req: AutoImproveReq):
    """无 JD 时的『自动修改』：按 rubric 体检弱项做 patch 改写（结构造假物理不可能）。

    先评分定位弱项，再 improve_via_patch；返回改动 diff + 评估基线 + 说明 + 事实缺口。
    """
    if req.role not in rubrics.RUBRICS:
        raise ApiError("BAD_ROLE", f"未知岗位：{req.role}")
    rubric = rubrics.get_rubric(req.role)
    try:
        evaluation = ev_mod.evaluate(req.resume, rubric, chat())
        result = improve_via_patch(req.resume, evaluation, chat(), rubric=rubric)
    except ValueError as e:
        raise ApiError("IMPROVE_FAILED", f"自动修改失败：{e}", retryable=True)
    changes = [{"kind": c.kind, "path": c.path, "old": c.old, "new": c.new}
               for c in diff_resume(req.resume, result.resume)]
    notes = [f"{v.kind}: {v.detail}" for v in result.violations]
    return {"changes": changes, "notes": notes, "gaps": result.gaps,
            "accepted": result.accepted,
            "baseline": {"score": total_score(evaluation), "max": max_total(evaluation)}}


@app.post("/api/apply")
def api_apply(req: ApplyReq):
    """安全 diff 写回：逐条校验 old → 应用 → 全量 validate；返回逐项结果。"""
    resume = copy.deepcopy(req.resume)
    results = []
    for p in req.patches:
        cur = get_by_path(resume, p.path)
        if p.old is not None and str(cur or "").strip() != str(p.old).strip():
            results.append({"path": p.path, "status": "stale", "error": "原值已变，已跳过"})
            continue
        ok = set_by_path(resume, p.path, p.value)
        results.append({"path": p.path, "status": "applied" if ok else "invalid_path"})
    errs = validate_resume(resume)
    if errs:  # 写坏了 -> 回退，不落库
        return {"resume": req.resume, "results": results, "validation_errors": errs, "committed": False}
    return {"resume": resume, "results": results, "validation_errors": [], "committed": True}


@app.post("/api/evaluate")
def api_evaluate(req: EvalReq):
    if req.role not in rubrics.RUBRICS:
        raise ApiError("BAD_ROLE", f"未知岗位：{req.role}")
    rubric = rubrics.get_rubric(req.role)
    try:
        evaluation = ev_mod.evaluate(req.resume, rubric, chat())
    except ValueError as e:
        raise ApiError("EVAL_FAILED", f"评分失败：{e}", retryable=True)
    return {"evaluation": evaluation, "score": total_score(evaluation),
            "max": max_total(evaluation),
            "gaps": fact_gap_report(req.resume, evaluation, rubric),
            "role_label": rubric.role}


@app.post("/api/render")
def api_render(req: RenderReq):
    if req.lang not in kami_adapter.TEMPLATE_BY_LANG:
        raise ApiError("BAD_LANG", f"未知语言：{req.lang}")
    try:
        html = kami_adapter.render_html(req.resume, lang=req.lang, role=req.role)
    except ValueError as e:
        raise ApiError("RENDER_FAILED", f"渲染失败：{e}")
    return {"html": html}


@app.get("/api/roles")
def api_roles():
    return {"roles": [{"key": k, "label": r.role} for k, r in rubrics.RUBRICS.items()]}


# --------------------------------------------------------------------------- #
# 多简历持久化（见 docs/plans/multi-resume-persistence.md）
# --------------------------------------------------------------------------- #
def _check_role(role: str):
    if role not in rubrics.RUBRICS:
        raise ApiError("BAD_ROLE", f"未知岗位：{role}")


def _check_data(data: Dict[str, Any]):
    errs = validate_resume(data)
    if errs:
        raise ApiError("BAD_RESUME", f"简历结构不合法：{errs[0]}")


@app.get("/api/resumes")
def api_resumes_list():
    return {"resumes": get_repo().list()}


@app.post("/api/resumes")
def api_resumes_create(req: ResumeCreateReq):
    role = req.role or "engineer"
    _check_role(role)
    data = req.data if req.data is not None else {"basics": {}}
    _check_data(data)
    title = (req.title or "").strip() or (data.get("basics") or {}).get("name") or "未命名简历"
    return get_repo().create(title, role, req.jd, data, req.export_md)


@app.get("/api/resumes/{rid}")
def api_resumes_get(rid: str):
    return get_repo().get(rid)                       # RepoNotFound → 404


@app.put("/api/resumes/{rid}")
def api_resumes_update(rid: str, req: ResumeUpdateReq):
    patch: Dict[str, Any] = {}

    def want(name: str, val: Any):
        # 有 fields：精确按声明改（允许显式设 None，如清空 export_md）；无 fields：只改非 None 值
        if req.fields is not None:
            if name in req.fields:
                patch[name] = val
        elif val is not None:
            patch[name] = val

    want("title", req.title); want("role", req.role); want("jd", req.jd)
    want("data", req.data); want("export_md", req.export_md)
    if "role" in patch:
        _check_role(patch["role"])
    if "data" in patch:
        _check_data(patch["data"])
    return get_repo().update(rid, patch, req.version, req.note)  # RepoNotFound→404 / RepoConflict→409


@app.delete("/api/resumes/{rid}")
def api_resumes_delete(rid: str):
    get_repo().delete(rid)
    return {"deleted": True}


@app.post("/api/resumes/{rid}/duplicate")
def api_resumes_duplicate(rid: str):
    return get_repo().duplicate(rid)


@app.get("/api/resumes/{rid}/revisions")
def api_resumes_revisions(rid: str):
    return {"revisions": get_repo().list_revisions(rid)}


@app.post("/api/resumes/{rid}/rollback")
def api_resumes_rollback(rid: str, req: RollbackReq):
    return get_repo().rollback(rid, req.revisionId, req.version)


# 静态：优先 Vite 构建产物；无则回退旧壳（开发时用 vite dev 代理）
STATIC = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")
_ASSETS = STATIC / "assets"
if _ASSETS.is_dir():
    app.mount("/assets", StaticFiles(directory=str(_ASSETS)), name="assets")


@app.get("/", response_class=HTMLResponse)
def index():
    # index.html 不缓存：hash 化的 bundle 名一变，浏览器立刻拿到新前端（避免旧壳缓存）。
    return HTMLResponse(
        (STATIC / "index.html").read_text("utf-8"),
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )
