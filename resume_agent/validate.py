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


# --- 编辑表单 v3 新增字段校验（见 docs/plans/resume-edit-form-v3.md §3.1）---
# 只校验形状/类型/枚举/长度/边界，不校验必填（必填由前端 validateResumeForm 提示，
# 否则新增空条目在填写期间无法 autosave）。全部字段可空，老数据零迁移。
import re as _re

_GENDER = {"male", "female"}
_STUDY_MODE = {"full_time", "part_time"}
_BIRTH_RE = _re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# 新引入的多实例模块数组（既有 volunteer/certificates/awards 维持全局 200 上限，不在此列）
_NEW_ARRAYS = ["internships", "organizations", "campus", "thesis", "competitions", "custom_sections"]
_NEW_ARRAY_MAX = 20
# 「添加模块」面板可启用的模块 key（modules_order 成员，custom 走 custom:<id> 形式）
_MODULE_KEYS = {
    "job_intent", "internships", "organizations", "awards", "volunteer",
    "campus", "thesis", "competitions", "certificates",
}


def _check_new_fields(resume: Dict[str, Any]) -> List[str]:
    errs: List[str] = []
    b = resume.get("basics")
    if isinstance(b, dict):
        g = b.get("gender")
        if g is not None and g not in _GENDER:
            errs.append("basics.gender 必须是 male 或 female")
        bm = b.get("birthMonth")
        if bm is not None:
            if not isinstance(bm, str) or not _BIRTH_RE.match(bm) or not (1900 <= int(bm[:4]) <= 2100):
                errs.append("basics.birthMonth 必须是 YYYY-MM（月份 01–12，年 1900–2100）")
        for f in ("wechat", "hometown"):
            v = b.get(f)
            if v is not None and not isinstance(v, str):
                errs.append(f"basics.{f} 必须是字符串")
        if isinstance(b.get("hometown"), str) and len(b["hometown"]) > 20:
            errs.append("basics.hometown 过长（> 20 字）")
        tags = b.get("tags")
        if tags is not None:
            if not _is_str_list(tags):
                errs.append("basics.tags 必须是字符串列表")
            else:
                if len(tags) > 8:
                    errs.append("basics.tags 最多 8 个")
                if any(len(x) > 12 for x in tags):
                    errs.append("basics.tags 单个标签过长（> 12 字）")

    # skills_md：顶层富文本（长度由全局 MAX_STR_LEN 兜底）
    if resume.get("skills_md") is not None and not isinstance(resume["skills_md"], str):
        errs.append("skills_md 必须是字符串")

    # 教育：studyMode 枚举 + description 类型
    edu = resume.get("education")
    if isinstance(edu, list):
        for i, it in enumerate(edu):
            if not isinstance(it, dict):
                continue
            sm = it.get("studyMode")
            if sm is not None and sm not in _STUDY_MODE:
                errs.append(f"education[{i}].studyMode 必须是 full_time 或 part_time")
            if it.get("description") is not None and not isinstance(it["description"], str):
                errs.append(f"education[{i}].description 必须是字符串")

    # work/projects/volunteer.description 类型 + projects.role/日期
    for sec in ("work", "projects", "volunteer"):
        val = resume.get(sec)
        if isinstance(val, list):
            for i, it in enumerate(val):
                if isinstance(it, dict) and it.get("description") is not None and not isinstance(it["description"], str):
                    errs.append(f"{sec}[{i}].description 必须是字符串")
    proj = resume.get("projects")
    if isinstance(proj, list):
        for i, it in enumerate(proj):
            if not isinstance(it, dict):
                continue
            if it.get("role") is not None and not isinstance(it["role"], str):
                errs.append(f"projects[{i}].role 必须是字符串")
            for df in ("startDate", "endDate"):
                v = it.get(df)
                if v is not None and (not isinstance(v, str) or len(v) > 20):
                    errs.append(f"projects[{i}].{df} 非法（须为 ≤20 字字符串）")

    # 求职意向 job_intent{positions[]≤5, city}
    ji = resume.get("job_intent")
    if ji is not None:
        if not isinstance(ji, dict):
            errs.append("job_intent 必须是对象")
        else:
            pos = ji.get("positions")
            if pos is not None:
                if not _is_str_list(pos):
                    errs.append("job_intent.positions 必须是字符串列表")
                elif len(pos) > 5:
                    errs.append("job_intent.positions 最多 5 个")
                elif any(len(x) > 20 for x in pos):
                    errs.append("job_intent.positions 单项过长（> 20 字）")
            city = ji.get("city")
            if city is not None and (not isinstance(city, str) or len(city) > 20):
                errs.append("job_intent.city 非法（须为 ≤20 字字符串）")

    # 新引入的多实例数组：list of dict，≤20 条
    for sec in _NEW_ARRAYS:
        val = resume.get(sec)
        if val is None:
            continue
        if not isinstance(val, list):
            errs.append(f"{sec} 必须是列表")
            continue
        if len(val) > _NEW_ARRAY_MAX:
            errs.append(f"{sec} 最多 {_NEW_ARRAY_MAX} 条")
        for i, it in enumerate(val[: _NEW_ARRAY_MAX + 1]):
            if not isinstance(it, dict):
                errs.append(f"{sec}[{i}] 必须是对象")

    # 自定义模块：id 唯一 + title ≤10 + content 字符串
    custom = resume.get("custom_sections")
    custom_ids: List[str] = []
    if isinstance(custom, list):
        for i, it in enumerate(custom):
            if not isinstance(it, dict):
                continue
            cid = it.get("id")
            if cid is not None:
                if not isinstance(cid, str):
                    errs.append(f"custom_sections[{i}].id 必须是字符串")
                else:
                    custom_ids.append(cid)
            title = it.get("title")
            if title is not None and (not isinstance(title, str) or len(title) > 10):
                errs.append(f"custom_sections[{i}].title 非法（须为 ≤10 字字符串）")
            if it.get("content") is not None and not isinstance(it["content"], str):
                errs.append(f"custom_sections[{i}].content 必须是字符串")
        if len(custom_ids) != len(set(custom_ids)):
            errs.append("custom_sections 的 id 必须唯一")

    # 模块顺序 modules_order：已知 key 或 custom:<存在且唯一的 id>，无重复
    order = resume.get("modules_order")
    if order is not None:
        if not _is_str_list(order):
            errs.append("modules_order 必须是字符串列表")
        else:
            if len(order) != len(set(order)):
                errs.append("modules_order 不能有重复项")
            for key in order:
                if key.startswith("custom:"):
                    if key[len("custom:"):] not in custom_ids:
                        errs.append(f"modules_order 项 {key} 未引用存在的 custom_sections.id")
                elif key not in _MODULE_KEYS:
                    errs.append(f"modules_order 含未知模块 {key}")
    return errs


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

    errors.extend(_check_new_fields(resume))   # 编辑表单 v3 新增字段（并入统一入口，覆盖所有调用方）
    errors.extend(_length_errors(resume))
    return errors


def is_valid(resume: Any) -> bool:
    return not validate_resume(resume)


def ensure_valid(resume: Any) -> None:
    """校验不通过则抛 ValueError，错误合并为一段可读信息。"""
    errors = validate_resume(resume)
    if errors:
        raise ValueError("JSON Resume 结构不合法：\n  - " + "\n  - ".join(errors))
