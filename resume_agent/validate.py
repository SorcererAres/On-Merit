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
# (section, 字段) -> 非空时必须是字符串（下游 resume_to_text / safe_url / .lower() 依赖）
_STR_FIELDS = [
    ("work", "url"), ("volunteer", "url"), ("projects", "url"),
    ("certificates", "url"), ("publications", "url"), ("education", "url"),
]


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


# --- 体量上限（防注入 / 防撑爆上下文；借鉴 self.so resume.ts 的 Zod max）---
# 正常简历远达不到这些阈值；此闸只拦异常输入（海量条目、单字段塞巨量文本、
# 借超长内容做 prompt 注入 / 撑爆下游上下文）。故意设得宽松，宁可放过大简历也不误伤。
MAX_STR_LEN = 20_000       # 单个字符串字段字符上限
MAX_ARRAY_LEN = 200        # 单个数组元素个数上限
MAX_TOTAL_CHARS = 400_000  # 整份简历所有字符串字符总量上限（ingest 抽取上限的 2 倍）


def _length_errors(resume: Any) -> List[str]:
    """递归核查体量：单字符串过长、单数组过长、字符总量过大。返回错误清单。"""
    errors: List[str] = []
    total = 0

    def walk(node: Any, path: str) -> None:
        nonlocal total
        if isinstance(node, str):
            total += len(node)
            if len(node) > MAX_STR_LEN:
                errors.append(f"{path or '根'} 文本过长（{len(node)} 字符 > {MAX_STR_LEN}），疑似异常输入")
        elif isinstance(node, list):
            if len(node) > MAX_ARRAY_LEN:
                errors.append(f"{path or '根'} 列表过长（{len(node)} 项 > {MAX_ARRAY_LEN}），疑似异常输入")
            for i, x in enumerate(node[: MAX_ARRAY_LEN + 1]):  # 超限后无需全量遍历
                walk(x, f"{path}[{i}]")
        elif isinstance(node, dict):
            for k, v in node.items():
                walk(v, f"{path}.{k}" if path else str(k))

    walk(resume, "")
    if total > MAX_TOTAL_CHARS:
        errors.append(f"简历文本总量过大（{total} 字符 > {MAX_TOTAL_CHARS}），疑似异常输入")
    return errors


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
            if basics.get("url") is not None and not isinstance(basics["url"], str):
                errors.append("basics.url 必须是字符串")
            loc = basics.get("location")
            if loc is not None and not isinstance(loc, dict):
                errors.append("basics.location 必须是对象")
            profs = basics.get("profiles")
            if profs is not None:
                if not isinstance(profs, list):
                    errors.append("basics.profiles 必须是列表")
                else:
                    for i, p in enumerate(profs):
                        if not isinstance(p, dict):
                            errors.append(f"basics.profiles[{i}] 必须是对象")
                            continue
                        if p.get("network") is not None and not isinstance(p["network"], str):
                            errors.append(f"basics.profiles[{i}].network 必须是字符串")
                        if p.get("url") is not None and not isinstance(p["url"], str):
                            errors.append(f"basics.profiles[{i}].url 必须是字符串")

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

    # 嵌套字段校验：仅当 section 确实是 list 时进入，避免被非 list 输入击穿
    def _dict_items(sec: str):
        val = resume.get(sec)
        if not isinstance(val, list):
            return
        for i, item in enumerate(val):
            if isinstance(item, dict):
                yield i, item

    for sec, field in _STR_LISTS:
        for i, item in _dict_items(sec):
            v = item.get(field)
            if v is not None and not _is_str_list(v):
                errors.append(f"{sec}[{i}].{field} 必须是字符串列表")

    for sec, field in _STR_FIELDS:
        for i, item in _dict_items(sec):
            v = item.get(field)
            if v is not None and not isinstance(v, str):
                errors.append(f"{sec}[{i}].{field} 必须是字符串")

    errors.extend(_length_errors(resume))
    return errors


def is_valid(resume: Any) -> bool:
    return not validate_resume(resume)


def ensure_valid(resume: Any) -> None:
    """校验不通过则抛 ValueError，错误合并为一段可读信息。"""
    errors = validate_resume(resume)
    if errors:
        raise ValueError("JSON Resume 结构不合法：\n  - " + "\n  - ".join(errors))
