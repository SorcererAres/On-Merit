"""P7：JSON Resume 输入形状校验（fail-fast 入口闸）。

Codex 两轮评审都指出：improver / patcher / brand / kami_adapter 都隐含假设
「section 是 list、item 是 dict、highlights 是 str 列表」，却没有入口校验，畸形输入会在
深处抛 AttributeError 或被误当文本叶子。本模块在管线入口集中校验这些**结构形状**，
让畸形简历立刻以可读错误失败，而不是靠各处零散兜底。

只校验下游真正依赖的形状，不做逐字段类型全检（那是 hiring-agent pydantic JSONResume 的活）。
纯函数、无依赖、离线可测。
"""

from __future__ import annotations

from typing import Any, Dict, List

# section -> 元素必须是 dict 的列表
_LIST_OF_DICT = [
    "work", "volunteer", "projects", "skills", "education",
    "awards", "certificates", "publications", "languages", "references", "interests",
]
# (section, 字段) -> 必须是「字符串列表」
_STR_LISTS = [
    ("work", "highlights"), ("volunteer", "highlights"), ("projects", "highlights"),
    ("projects", "technologies"), ("projects", "skills"),
    ("skills", "keywords"), ("education", "courses"),
]


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


def validate_resume(resume: Any) -> List[str]:
    """返回结构错误清单（空 = 合法）。错误信息可读、带路径。"""
    errors: List[str] = []

    if not isinstance(resume, dict):
        return [f"根节点必须是 JSON 对象，实际是 {type(resume).__name__}"]

    basics = resume.get("basics")
    if basics is not None:
        if not isinstance(basics, dict):
            errors.append("basics 必须是对象")
        else:
            if basics.get("name") is not None and not isinstance(basics["name"], str):
                errors.append("basics.name 必须是字符串")
            loc = basics.get("location")
            if loc is not None and not isinstance(loc, dict):
                errors.append("basics.location 必须是对象")
            profs = basics.get("profiles")
            if profs is not None:
                if not isinstance(profs, list):
                    errors.append("basics.profiles 必须是列表")
                elif not all(isinstance(p, dict) for p in profs):
                    errors.append("basics.profiles 每项必须是对象")

    for sec in _LIST_OF_DICT:
        val = resume.get(sec)
        if val is None:
            continue
        if not isinstance(val, list):
            errors.append(f"{sec} 必须是列表")
            continue
        for i, item in enumerate(val):
            if not isinstance(item, dict):
                errors.append(f"{sec}[{i}] 必须是对象，实际是 {type(item).__name__}")

    for sec, field in _STR_LISTS:
        for i, item in enumerate(resume.get(sec) or []):
            if not isinstance(item, dict):
                continue  # 上面已报
            v = item.get(field)
            if v is not None and not _is_str_list(v):
                errors.append(f"{sec}[{i}].{field} 必须是字符串列表")

    return errors


def is_valid(resume: Any) -> bool:
    return not validate_resume(resume)


def ensure_valid(resume: Any) -> None:
    """校验不通过则抛 ValueError，错误合并为一段可读信息。"""
    errors = validate_resume(resume)
    if errors:
        raise ValueError("JSON Resume 结构不合法：\n  - " + "\n  - ".join(errors))
