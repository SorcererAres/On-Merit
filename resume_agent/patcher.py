"""P6：patch-only 反造假架构。

把改写从「模型返回整份新简历，再机器查虚构」升级为「模型只返回受限 patch」：

  - 模型只能提交 ``{path, text}`` 形式的补丁，path 必须来自**预先枚举的可编辑文本字段**
    （summary / highlights / description / skill.level）；
  - 结构字段（公司名 / 日期 / URL / 机构 / 条目数）**根本没有 patch 路径**，模型无从下手；
  - highlights 只能改**已存在的下标**，不能追加 -> 净新增 bullet 物理上不可能。

于是结构造假从「事后检测」变为「事前不可表达」，这是比正则校验更接近本质的反造假边界。
唯一仍需校验的是「可编辑文本里是否塞入原文没有的数字」，复用 improver 的数字校验。

与 improver.improve（整份重写 + 校验）并存：patch 路更严更安全，整份重写更灵活。
"""

from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from jsonx import parse_json_lenient
from improver import (
    ChatFn,
    ImproveResult,
    Violation,
    fact_gap_report,
    _collect_text,
    _numbers,
    _YEAR,
    total_score,
    weakest_categories,
)

# 可编辑路径的正则（section[index].field 或 section[index].highlights[j]）
_EDITABLE_PATTERNS = [
    re.compile(r"^basics\.summary$"),
    re.compile(r"^(?P<sec>work|volunteer)\[(?P<i>\d+)\]\.summary$"),
    re.compile(r"^projects\[(?P<i>\d+)\]\.description$"),
    re.compile(r"^skills\[(?P<i>\d+)\]\.level$"),
    re.compile(r"^(?P<sec>work|volunteer|projects)\[(?P<i>\d+)\]\.highlights\[(?P<j>\d+)\]$"),
]


def _is_str(v: Any) -> bool:
    return isinstance(v, str)


# 富文本可编辑字段的实质内容门槛：剥空白后 ≥10 字才开放改写——空/近空字段交给改写模型
# 等于开凭空生成入口（编辑表单 v3 §3.2）。
def _md_ok(v: Any) -> bool:
    return isinstance(v, str) and len(v.strip()) >= 10


# md 富文本路径（保留换行=列表结构）；其余（highlights/level/旧 work·volunteer.summary）
# 折叠换行防伪造多条。注意：不能一刀切匹配 .summary——work[i].summary/volunteer[i].summary
# 是旧结构的单段职责摘要（非 md），换行须折叠；只有 basics.summary（个人优势 md）保留换行。
def _is_md_path(path: str) -> bool:
    return (path == "basics.summary" or path == "skills_md"
            or path.endswith(".description") or path.endswith(".content"))


def _enum_dicts(resume: Dict[str, Any], sec: str):
    """按**原始下标**产出 section 里的 dict 元素 (i, item)；非 list/非 dict 跳过但不重排下标。"""
    raw = resume.get(sec)
    if not isinstance(raw, list):
        return
    for i, item in enumerate(raw):
        if isinstance(item, dict):
            yield i, item


def _str_highlights(item: Dict[str, Any]):
    """按原始下标产出 highlights 里的字符串元素 (j, hl)。"""
    hl = item.get("highlights")
    if not isinstance(hl, list):
        return
    for j, x in enumerate(hl):
        if isinstance(x, str):
            yield j, x


def editable_paths(resume: Dict[str, Any]) -> List[str]:
    """枚举当前简历**实际存在且为字符串**的可编辑文本路径，喂给模型当白名单。

    只枚举值为 ``str`` 的叶子：None / 数字 / 对象都不算可编辑，从根上杜绝「凭空补文本」。
    对畸形结构（section 非 list、item 非 dict、highlights 非 list）容错忽略，且**保留原始下标**，
    确保 path 下标与 _set_at 导航一致。
    """
    if not isinstance(resume, dict):
        return []
    paths: List[str] = []
    basics = resume.get("basics")
    if isinstance(basics, dict) and _md_ok(basics.get("summary")):
        paths.append("basics.summary")
    if _md_ok(resume.get("skills_md")):
        paths.append("skills_md")
    # 经历型：description 存在（且实质内容 ≥10 字）→ 只开放 description（不再开 summary/highlights，
    # 改了也不渲染，属无效改写）；否则回退旧 summary/highlights。（编辑表单 v3 §3.2 统一优先级）
    for sec in ("work", "volunteer", "internships", "organizations", "campus", "thesis", "competitions"):
        for i, item in _enum_dicts(resume, sec):
            if _md_ok(item.get("description")):
                paths.append(f"{sec}[{i}].description")
            else:
                if _is_str(item.get("summary")):
                    paths.append(f"{sec}[{i}].summary")
                for j, _ in _str_highlights(item):
                    paths.append(f"{sec}[{i}].highlights[{j}]")
    for i, item in _enum_dicts(resume, "projects"):
        if _md_ok(item.get("description")):
            paths.append(f"projects[{i}].description")
        else:
            for j, _ in _str_highlights(item):
                paths.append(f"projects[{i}].highlights[{j}]")
    for i, item in _enum_dicts(resume, "education"):
        if _md_ok(item.get("description")):
            paths.append(f"education[{i}].description")
    for i, item in _enum_dicts(resume, "custom_sections"):
        if _md_ok(item.get("content")):
            paths.append(f"custom_sections[{i}].content")
    for i, item in _enum_dicts(resume, "skills"):
        if _is_str(item.get("level")):
            paths.append(f"skills[{i}].level")
    return paths


def _path_exists(resume: Dict[str, Any], path: str) -> bool:
    """该 path 是否是当前简历的合法可编辑叶子。

    **精确成员校验**：直接判断 path 是否在 ``editable_paths(resume)`` 里，而不是「匹配正则」。
    这样 None 值字段（不会被枚举）、`work[00]` 这类正则别名、Unicode/超长索引都自然被拒，
    白名单即枚举列表本身，没有第二套解析逻辑可被绕过。
    """
    return path in set(editable_paths(resume))


def _set_at(resume: Dict[str, Any], path: str, value: str) -> None:
    """把 value 写入 path（仅处理本模块定义的可编辑形状）。"""
    if path == "basics.summary":
        resume["basics"]["summary"] = value
        return
    if path == "skills_md":
        resume["skills_md"] = value
        return
    m = re.match(r"^(\w+)\[(\d+)\](?:\.(\w+)(?:\[(\d+)\])?)?$", path)
    sec, i, field_name, j = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    item = resume[sec][i]
    if field_name == "highlights":
        item["highlights"][int(j)] = value
    else:
        item[field_name] = value


# --------------------------------------------------------------------------- #
# Prompt
# --------------------------------------------------------------------------- #
PATCH_SYSTEM = """你是一个简历改写助手，只能通过「补丁」修改简历文字，不能新增任何经历或事实。

你只能返回一个 JSON 数组，每个元素形如 {"path": "<允许的路径>", "text": "<改写后的文字>"}。

硬规则：
1. path 只能来自下方【可编辑字段】列表，一字不差。其它字段（公司名、日期、链接、机构、
   条目数量）你无法修改，也不要尝试。
2. text 只能重述该字段已有的事实：可做 STAR 结构化、突出原文已出现的数字、让表述更专业；
   不得引入原文没有的数字、技术、客户或机构。
3. 不需要改的字段就不要放进数组。只返回 JSON 数组，不要解释、不要 markdown 代码块。"""

PATCH_USER_TEMPLATE = """## 评估反馈
总分：{total} / 120，最弱类别：{weak}
需要改进：
{areas}

## 可编辑字段（path 只能从这里选）
{paths}

## 各字段当前内容
{contents}

## 输出
返回 JSON 数组 [{{"path": ..., "text": ...}}]，只改需要改的字段。"""


def _read_at(resume: Dict[str, Any], path: str) -> str:
    if path == "basics.summary":
        return (resume.get("basics") or {}).get("summary") or ""
    m = re.match(r"^(\w+)\[(\d+)\](?:\.(\w+)(?:\[(\d+)\])?)?$", path)
    sec, i, field_name, j = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    item = (resume.get(sec) or [])[i]
    if field_name == "highlights":
        return (item.get("highlights") or [])[int(j)]
    return item.get(field_name) or ""


def build_patch_prompt(
    resume: Dict[str, Any], evaluation: Dict[str, Any]
) -> List[Dict[str, str]]:
    paths = editable_paths(resume)
    contents = "\n".join(f"- {p}: {_read_at(resume, p)}" for p in paths)
    areas = evaluation.get("areas_for_improvement") or []
    user = PATCH_USER_TEMPLATE.format(
        total=total_score(evaluation),
        weak=", ".join(weakest_categories(evaluation)),
        areas="\n".join(f"- {a}" for a in areas) or "- （无）",
        paths="\n".join(f"- {p}" for p in paths),
        contents=contents,
    )
    return [
        {"role": "system", "content": PATCH_SYSTEM},
        {"role": "user", "content": user},
    ]


# --------------------------------------------------------------------------- #
# 应用补丁
# --------------------------------------------------------------------------- #
@dataclass
class PatchOutcome:
    resume: Dict[str, Any]
    applied: List[str] = field(default_factory=list)
    rejected: List[Tuple[str, str]] = field(default_factory=list)  # (path, 原因)


_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean_patch_text(text: str, path: str = "") -> str:
    """净化补丁文本：去控制字符。

    非 md 字段（highlights/level）折叠换行为空格——防单条 highlight 用换行伪造多条。
    md 富文本字段（description/content/summary/skills_md）保留换行——换行是列表结构，
    折叠会毁掉列表（编辑表单 v3 §3.2）；仅逐行 trim + 去多余空行。
    """
    text = _CONTROL_RE.sub("", text)
    if _is_md_path(path):
        lines = [ln.rstrip() for ln in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        out, blank = [], 0
        for ln in lines:
            if ln.strip():
                out.append(ln); blank = 0
            elif blank == 0 and out:       # 段落间保留至多一个空行
                out.append(""); blank = 1
        return "\n".join(out).strip()
    return re.sub(r"\s*[\r\n]+\s*", " ", text).strip()


def apply_patches(
    resume: Dict[str, Any], patches: List[Dict[str, Any]]
) -> PatchOutcome:
    """确定性应用补丁：路径不在白名单或目标不存在 -> 拒绝该补丁（不影响其它）。"""
    new = copy.deepcopy(resume)
    allowed = set(editable_paths(new))  # 一次性快照，精确白名单
    applied: List[str] = []
    rejected: List[Tuple[str, str]] = []
    for p in patches:
        if not isinstance(p, dict):
            rejected.append((str(p)[:40], "补丁元素必须是对象 {path, text}"))
            continue
        path = p.get("path")
        text = p.get("text")
        if not isinstance(path, str) or not isinstance(text, str):
            rejected.append((str(path), "补丁格式非法（path/text 必须是字符串）"))
            continue
        if path not in allowed:
            rejected.append((path, "路径不在可编辑白名单（疑似越权/造假）"))
            continue
        _set_at(new, path, _clean_patch_text(text, path))
        applied.append(path)
    return PatchOutcome(resume=new, applied=applied, rejected=rejected)


def _new_numbers(old: Dict[str, Any], new: Dict[str, Any]) -> set:
    invented = _numbers(_collect_text(new)) - _numbers(_collect_text(old))
    return {n for n in invented if not _YEAR.match(n)}


def _parse_patches(text: str) -> List[Dict[str, Any]]:
    return parse_json_lenient(text, root="array")  # 分级容错解析，见 jsonx.py


def improve_via_patch(
    resume: Dict[str, Any],
    evaluation: Dict[str, Any],
    chat_fn: ChatFn,
    *,
    strict_numbers: bool = True,
    rubric: Any = None,
) -> ImproveResult:
    """patch-only 改写。结构造假物理不可能；仍校验可编辑文本里的凭空数字。"""
    gaps = fact_gap_report(resume, evaluation, rubric)
    messages = build_patch_prompt(resume, evaluation)
    try:
        raw = chat_fn(messages)
    except Exception as e:
        return ImproveResult(resume, False, [Violation("error", "chat_fail", str(e))], gaps, "")

    try:
        patches = _parse_patches(raw)
    except Exception as e:
        return ImproveResult(
            resume, False, [Violation("error", "parse_fail", f"无法解析补丁：{e}")], gaps, raw
        )

    outcome = apply_patches(resume, patches)
    violations = [
        Violation("warn", "patch_rejected", f"{path}：{why}")
        for path, why in outcome.rejected
    ]

    invented = _new_numbers(resume, outcome.resume)
    if invented:
        violations.append(
            Violation(
                "error" if strict_numbers else "warn",
                "new_number",
                f"补丁文本含原文没有的数字（疑似编造）：{sorted(invented)}",
            )
        )

    has_error = any(v.severity == "error" for v in violations)
    if has_error:
        return ImproveResult(copy.deepcopy(resume), False, violations, gaps, raw)
    return ImproveResult(outcome.resume, True, violations, gaps, raw)
