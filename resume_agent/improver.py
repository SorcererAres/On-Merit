"""P1：事实约束改写模块（闭环的「灵魂」）。

把 hiring-agent 评估结果（``EvaluationData``）的 ``areas_for_improvement`` 与各项
``evidence``，转成对 JSON Resume 的**事实约束改写**，实现单轮「评分 -> 改写 -> 再评分」提分。

红线（见 DESIGN.md 第六节）：只允许「重述、结构化、量化已有事实」，禁止编造经历。
本模块用两道闸控制风险：
  1. 强约束 prompt（``build_improve_prompt``）：明确告诉模型只能改写、不能新增实体或数字；
  2. 确定性反造假校验（``validate_no_fabrication``）：改写后机器核对，发现新公司 /
     新项目 / 凭空数字就**拒绝整次改写**，保证任何虚构都进不了交付物。

另有 ``fact_gap_report``：识别靠「事实层」拿分的缺口（如开源分低因全是个人项目），
这类不自动改写，只在报告里标「需真实补充」提示用户。

LLM 调用通过可注入的 ``chat_fn`` 抽象，既能复用 hiring-agent 的 provider，也能离线测试。
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

# chat_fn 约定：输入 messages（OpenAI 风格 [{role, content}]），返回模型文本。
ChatFn = Callable[[List[Dict[str, str]]], str]

# 改写时允许「凭空出现」的数字白名单：年份等，避免误伤。
_YEAR = re.compile(r"^(19|20)\d{2}$")


# --------------------------------------------------------------------------- #
# 评分工具
# --------------------------------------------------------------------------- #
def _num(v: Any, default: float = 0.0) -> float:
    """容错取有限数值；非数 / bool / NaN / Inf -> default。"""
    import math
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
        return float(v)
    return default


def total_score(evaluation: Dict[str, Any]) -> float:
    """总分：各类（封顶）+ bonus - deductions，最终夹到 [0, 各类满分和 + 20]。

    夹紧防止 LLM/扣分把总分弄成负数或越界（评审反复点出）。各类满分和通常 100，故上限 120。
    """
    scores = evaluation.get("scores") if isinstance(evaluation, dict) else {}
    scores = scores if isinstance(scores, dict) else {}
    total = 0.0
    cat_max_sum = 0.0
    for cat in scores.values():
        cat = cat if isinstance(cat, dict) else {}
        mx = _num(cat.get("max", 0))
        cat_max_sum += mx
        total += min(_num(cat.get("score", 0)), mx)
    total += _num((evaluation.get("bonus_points") or {}).get("total", 0))
    total -= _num((evaluation.get("deductions") or {}).get("total", 0))
    return round(max(0.0, min(total, cat_max_sum + 20.0)), 1)


def weakest_categories(evaluation: Dict[str, Any]) -> List[str]:
    """按「得分率」从低到高排序的类别名，用来引导改写优先级。"""
    scores = evaluation.get("scores") if isinstance(evaluation, dict) else {}
    scores = scores if isinstance(scores, dict) else {}
    ratios: List[Tuple[float, str]] = []
    for name, cat in scores.items():
        cat = cat if isinstance(cat, dict) else {}
        mx = _num(cat.get("max", 1)) or 1
        ratios.append((_num(cat.get("score", 0)) / mx, name))
    ratios.sort()
    return [name for _, name in ratios]


# --------------------------------------------------------------------------- #
# Prompt
# --------------------------------------------------------------------------- #
IMPROVE_SYSTEM = """你是一个简历改写助手。你的唯一任务是在【绝不编造事实】的前提下，
重写给定 JSON Resume 的文字，使其更符合工程招聘的评估标准。

硬规则（违反任意一条都算失败）：
1. 不得新增任何工作经历、项目、教育或奖项条目；只能改写已有条目的文字。
2. 不得引入原文不存在的公司名、项目名、机构名。
3. 不得编造数字、指标、星标、用户量；只能复用原文已出现的数字。
4. 允许：把职责改成「动作 + 量化结果」的 STAR 结构、突出原文已出现的关键数字、
   让描述更紧凑专业。不得推断或补充原文未明确写出的技术、工具或事实。
5. 严格输出与输入同构的 JSON Resume，不要加解释、不要加 markdown 代码块。"""

IMPROVE_USER_TEMPLATE = """## 评估反馈
总分：{total} / 120
最弱类别（优先改写）：{weak}

各项证据：
{evidence}

需要改进：
{areas}

## 当前简历 JSON
{resume_json}

## 输出
只输出改写后的 JSON Resume（结构与输入一致）。记住：只能重述已有事实，不能新增条目或编造数字。"""


def build_improve_prompt(
    resume: Dict[str, Any], evaluation: Dict[str, Any]
) -> List[Dict[str, str]]:
    scores = evaluation.get("scores") or {}
    evidence_lines = [
        f"- {name}: {cat.get('score')}/{cat.get('max')} — {cat.get('evidence', '')}"
        for name, cat in scores.items()
    ]
    areas = evaluation.get("areas_for_improvement") or []
    user = IMPROVE_USER_TEMPLATE.format(
        total=total_score(evaluation),
        weak=", ".join(weakest_categories(evaluation)),
        evidence="\n".join(evidence_lines),
        areas="\n".join(f"- {a}" for a in areas) or "- （无）",
        resume_json=json.dumps(resume, ensure_ascii=False, indent=2),
    )
    return [
        {"role": "system", "content": IMPROVE_SYSTEM},
        {"role": "user", "content": user},
    ]


# --------------------------------------------------------------------------- #
# 反造假校验（确定性）
# --------------------------------------------------------------------------- #
@dataclass
class Violation:
    severity: str  # "error" | "warn"
    kind: str
    detail: str


def _names(items: Optional[List[Dict[str, Any]]], key: str) -> set:
    return {
        (it.get(key) or "").strip().lower()
        for it in (items or [])
        if (it.get(key) or "").strip()
    }


def _collect_text(obj: Any) -> str:
    """递归收集所有字符串值，拼成一个语料，用于数字核对。"""
    out: List[str] = []
    if isinstance(obj, dict):
        for v in obj.values():
            out.append(_collect_text(v))
    elif isinstance(obj, list):
        for v in obj:
            out.append(_collect_text(v))
    elif isinstance(obj, str):
        out.append(obj)
    return " ".join(out)


def _numbers(text: str) -> set:
    """抽取数字 token，归一化（去逗号 / 百分号 / 加号）。"""
    raw = re.findall(r"\d[\d,]*\.?\d*", text)
    return {r.replace(",", "") for r in raw}


def _highlight_count(items: Optional[List[Dict[str, Any]]], idx: int) -> int:
    if not items or idx >= len(items):
        return 0
    return len(items[idx].get("highlights") or [])


def validate_no_fabrication(
    old: Dict[str, Any],
    new: Dict[str, Any],
    *,
    strict_highlights: bool = False,
    strict_numbers: bool = True,
) -> List[Violation]:
    """对比改写前后，检测虚构。error 级会导致整次改写被拒。

    strict_highlights=True 时，任一 work/projects 条目的 highlights 数量增加（净新增
    要点）也判为 error。默认 False：净新增交给 resume_diff 标注、人工核对（分层防护）。

    strict_numbers=True（默认）时，原文没有的数字判 error 并回退，贴合「禁止编造数字」
    红线；设为 False 则降级为 warn（接受但标注，交人工确认）。
    """
    v: List[Violation] = []

    # 1. 实体不得新增（公司 / 项目 / 机构 / 奖项）
    checks = [
        ("work", "name", "工作经历公司"),
        ("projects", "name", "项目"),
        ("education", "institution", "教育机构"),
        ("awards", "title", "奖项"),
    ]
    for section, key, label in checks:
        old_set = _names(old.get(section), key)
        new_set = _names(new.get(section), key)
        invented = new_set - old_set
        if invented:
            v.append(
                Violation("error", "new_entity", f"新增{label}：{sorted(invented)}")
            )
        # 条目数不得增加
        if len(new.get(section) or []) > len(old.get(section) or []):
            v.append(
                Violation(
                    "error",
                    "more_items",
                    f"{label}条目数从 {len(old.get(section) or [])} 增到 {len(new.get(section) or [])}",
                )
            )

    # 2. 严格模式：highlights 净新增也算造假
    if strict_highlights:
        for section, label in (("work", "工作成果"), ("projects", "项目要点")):
            o_items = old.get(section) or []
            n_items = new.get(section) or []
            for i in range(len(n_items)):
                if _highlight_count(n_items, i) > _highlight_count(o_items, i):
                    v.append(
                        Violation(
                            "error",
                            "more_highlights",
                            f"{label} {section}[{i}] 净新增要点："
                            f"{_highlight_count(o_items, i)} -> {_highlight_count(n_items, i)}",
                        )
                    )

    # 3. 数字不得凭空出现（年份豁免）
    old_nums = _numbers(_collect_text(old))
    new_nums = _numbers(_collect_text(new))
    invented_nums = {
        n for n in (new_nums - old_nums) if not _YEAR.match(n)
    }
    if invented_nums:
        v.append(
            Violation(
                "error" if strict_numbers else "warn",
                "new_number",
                f"出现原文没有的数字（疑似编造）：{sorted(invented_nums)}",
            )
        )
    return v


# --------------------------------------------------------------------------- #
# 事实层缺口报告（不自动改写，提示用户补真实材料）
# --------------------------------------------------------------------------- #
def fact_gap_report(
    resume: Dict[str, Any], evaluation: Dict[str, Any], rubric: Any = None
) -> List[str]:
    """事实层缺口（不自动改写，提示补真实材料）。

    rubric 提供时用其岗位专属 gap_fn（设计师看作品集/量化，工程师看开源）；
    不提供时回退默认工程师逻辑（向后兼容）。
    """
    if rubric is not None and getattr(rubric, "gap_fn", None):
        return rubric.gap_fn(resume, evaluation)

    gaps: List[str] = []
    scores = evaluation.get("scores") or {}
    if "open_source" in scores and float((scores.get("open_source") or {}).get("score", 0)) <= 10:
        gaps.append(
            "开源分偏低：评分只认对【他人项目】的贡献。这是事实层缺口，"
            "需你真实补充对外部仓库的 PR / issue / 维护记录，改写无法提分。"
        )
    if not (resume.get("projects")):
        gaps.append("简历没有 projects 条目：需真实补充 1-3 个有链接的项目。")
    for p in resume.get("projects") or []:
        if not p.get("url"):
            gaps.append(
                f"项目「{p.get('name', '?')}」缺少链接：无链接会被扣 30-50%，"
                "请补 GitHub / Live Demo 真实地址。"
            )
    return gaps


# --------------------------------------------------------------------------- #
# 改写主流程
# --------------------------------------------------------------------------- #
@dataclass
class ImproveResult:
    resume: Dict[str, Any]  # 通过校验则为新简历，否则回退为原简历
    accepted: bool
    violations: List[Violation] = field(default_factory=list)
    gaps: List[str] = field(default_factory=list)
    raw: str = ""  # 模型原始输出，便于排查


def _parse_resume(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    # 取第一个 { 到最后一个 }，容错模型多说话
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    obj = json.loads(text)
    if not isinstance(obj, dict):
        raise ValueError(f"模型输出根节点不是 JSON 对象，而是 {type(obj).__name__}")
    return obj


def improve(
    resume: Dict[str, Any],
    evaluation: Dict[str, Any],
    chat_fn: ChatFn,
    *,
    strict_highlights: bool = False,
    strict_numbers: bool = True,
    rubric: Any = None,
) -> ImproveResult:
    """跑一次事实约束改写。

    硬违规（error）-> 拒绝改写、回退原简历，保证不虚构。
    软违规（warn）-> 接受但在报告里标注，交人工确认。
    strict_highlights / strict_numbers -> 见 validate_no_fabrication。
    rubric -> 岗位专属事实缺口检查（见 fact_gap_report）。
    """
    gaps = fact_gap_report(resume, evaluation, rubric)
    messages = build_improve_prompt(resume, evaluation)
    try:
        raw = chat_fn(messages)
    except Exception as e:
        return ImproveResult(
            resume=resume,
            accepted=False,
            violations=[Violation("error", "chat_fail", f"LLM 调用失败：{e}")],
            gaps=gaps,
            raw="",
        )

    try:
        new_resume = _parse_resume(raw)
    except Exception as e:
        return ImproveResult(
            resume=resume,
            accepted=False,
            violations=[Violation("error", "parse_fail", f"无法解析模型输出：{e}")],
            gaps=gaps,
            raw=raw,
        )

    violations = validate_no_fabrication(
        resume, new_resume,
        strict_highlights=strict_highlights,
        strict_numbers=strict_numbers,
    )
    has_error = any(x.severity == "error" for x in violations)
    if has_error:
        return ImproveResult(
            resume=copy.deepcopy(resume),  # 回退
            accepted=False,
            violations=violations,
            gaps=gaps,
            raw=raw,
        )
    return ImproveResult(
        resume=new_resume,
        accepted=True,
        violations=violations,
        gaps=gaps,
        raw=raw,
    )


# --------------------------------------------------------------------------- #
# 复用 hiring-agent provider 的 chat_fn 工厂
# --------------------------------------------------------------------------- #
def make_hiring_agent_chat_fn(model_name: Optional[str] = None) -> ChatFn:
    """把 hiring-agent 的 LLM provider 包成 chat_fn。

    需要 hiring-agent 在 sys.path 上，且配好 Ollama 或 Gemini。
    """
    import sys
    from pathlib import Path

    ha = Path(__file__).resolve().parent.parent / "hiring-agent"
    if str(ha) not in sys.path:
        sys.path.insert(0, str(ha))

    from llm_utils import initialize_llm_provider, extract_json_from_response
    from prompt import DEFAULT_MODEL

    model = model_name or DEFAULT_MODEL
    provider = initialize_llm_provider(model)

    def chat_fn(messages: List[Dict[str, str]]) -> str:
        resp = provider.chat(
            model=model,
            messages=messages,
            options={"temperature": 0.3, "top_p": 0.9, "stream": False},
        )
        return extract_json_from_response(resp["message"]["content"])

    return chat_fn
