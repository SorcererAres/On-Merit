"""P3b：~/.config/kami/brand.md 接入。

Kami 把 brand.md 当「最低优先级上下文」：仅在当前请求没给出某字段时作兜底，
绝不覆盖简历里已有的值。本模块：
  1. 解析 brand.md 的 YAML frontmatter（轻量自解析，不依赖 PyYAML）；
  2. 把品牌字段作为**兜底**填进 JSON Resume 的 basics（已有值优先）；
  3. 派生 agent 默认项（role / lang）。

字段对应见 Kami references/brand.example.md。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

DEFAULT_BRAND_PATH = Path.home() / ".config" / "kami" / "brand.md"

# brand.md language 值 -> 适配层 lang 码（ja 暂回退到 zh，适配层暂未接日文模板）
_LANG_MAP = {"cn": "zh", "zh": "zh", "en": "en", "ko": "ko"}


def _strip_inline_comment(value: str) -> str:
    """去掉引号外的 ``# 注释``。"""
    if value.startswith(('"', "'")):
        q = value[0]
        end = value.find(q, 1)
        return value[1:end] if end != -1 else value[1:]
    # 裸值：在 ' #' 处截断
    idx = value.find("#")
    if idx != -1:
        value = value[:idx]
    return value.strip()


def parse_brand(text: str) -> Dict[str, Any]:
    """解析 brand.md 文本 -> {字段..., 'habits': 正文}。"""
    fields: Dict[str, Any] = {}
    lines = text.splitlines()

    # 找 frontmatter（第一对 --- 之间）
    fm_start = next((i for i, l in enumerate(lines) if l.strip() == "---"), None)
    fm_end = None
    if fm_start is not None:
        for j in range(fm_start + 1, len(lines)):
            if lines[j].strip() == "---":
                fm_end = j
                break

    body_start = 0
    if fm_start is not None and fm_end is not None:
        for line in lines[fm_start + 1 : fm_end]:
            s = line.strip()
            if not s or s.startswith("#") or ":" not in s:
                continue
            key, _, raw = s.partition(":")
            val = _strip_inline_comment(raw.strip())
            if val:
                fields[key.strip()] = val
        body_start = fm_end + 1

    habits = "\n".join(lines[body_start:]).strip()
    if habits:
        fields["habits"] = habits
    return fields


def load_brand(path: Optional[Path] = None) -> Dict[str, Any]:
    """读取 brand.md；不存在返回空 dict。"""
    p = Path(path) if path else DEFAULT_BRAND_PATH
    if not p.exists():
        return {}
    return parse_brand(p.read_text(encoding="utf-8"))


def _ensure(d: Dict[str, Any], key: str) -> Dict[str, Any]:
    if not d.get(key):
        d[key] = {}
    return d[key]


def apply_brand(resume: Dict[str, Any], brand: Dict[str, Any]) -> Dict[str, Any]:
    """把品牌字段作为兜底填进 resume.basics（已有值不覆盖）。返回同一对象。"""
    if not brand:
        return resume
    basics = _ensure(resume, "basics")

    if not basics.get("name") and brand.get("name"):
        basics["name"] = brand["name"]
    if not basics.get("email") and brand.get("email"):
        basics["email"] = brand["email"]
    if not basics.get("url") and brand.get("website"):
        site = brand["website"]
        basics["url"] = site if site.startswith("http") else f"https://{site}"
    if brand.get("city"):
        loc = _ensure(basics, "location")
        if not loc.get("city"):
            loc["city"] = brand["city"]

    # GitHub handle -> 补一条 profile（若尚无 GitHub profile）
    gh = brand.get("github")
    if gh:
        profiles = basics.setdefault("profiles", [])
        has_gh = any(
            (p.get("network") or "").lower() == "github" for p in profiles
        )
        if not has_gh:
            profiles.append(
                {
                    "network": "GitHub",
                    "username": gh,
                    "url": f"https://github.com/{gh}",
                }
            )
    return resume


def brand_defaults(brand: Dict[str, Any]) -> Tuple[Optional[str], str]:
    """从品牌派生 (role, lang)。role 来自 role_title；lang 默认 zh。"""
    role = brand.get("role_title") or None
    lang = _LANG_MAP.get((brand.get("language") or "").lower(), "zh")
    return role, lang
