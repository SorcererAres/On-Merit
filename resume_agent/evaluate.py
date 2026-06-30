"""角色无关的 LLM 评估器（按 rubric 评分）。

不依赖 hiring-agent 的写死评估器：自带 resume->文本、按 rubric 生成 criteria prompt、
调 LLM、解析为标准评估结构。对任意 rubric（engineer / designer / 自定义）通用。

输出结构与 hiring-agent 一致，故 total_score / improver / resume_agent 直接复用：
    {"scores": {<catkey>: {score, max, evidence}}, "bonus_points": {...},
     "deductions": {...}, "key_strengths": [...], "areas_for_improvement": [...]}
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List

from rubrics import Rubric

ChatFn = Callable[[List[Dict[str, str]]], str]


# --------------------------------------------------------------------------- #
# resume -> 文本（自带，不依赖 hiring-agent）
# --------------------------------------------------------------------------- #
def resume_to_text(resume: Dict[str, Any]) -> str:
    parts: List[str] = []
    b = resume.get("basics") or {}
    if b:
        parts.append("=== 基本信息 ===")
        if b.get("name"):
            parts.append(f"姓名：{b['name']}")
        if b.get("summary"):
            parts.append(f"简介：{b['summary']}")
        if b.get("url"):
            parts.append(f"个人站/作品集：{b['url']}")
        for p in b.get("profiles") or []:
            parts.append(f"主页：{p.get('network','')} {p.get('url','')}")

    def _entries(title, items, fmt):
        if not items:
            return
        parts.append(f"\n=== {title} ===")
        for it in items:
            parts.append(fmt(it))

    _entries("工作经历", resume.get("work"), lambda w: (
        f"- {w.get('name','')} | {w.get('position','')} | "
        f"{w.get('startDate','')}-{w.get('endDate','')}\n  职责：{w.get('summary','')}\n"
        + "\n".join(f"  成果：{h}" for h in (w.get('highlights') or []))
    ))
    _entries("项目", resume.get("projects"), lambda p: (
        f"- {p.get('name','')} {('('+p['url']+')') if p.get('url') else '（无链接）'}：{p.get('description','')}"
        + (f" [{', '.join(p.get('technologies') or [])}]" if p.get('technologies') else "")
    ))
    _entries("志愿经历", resume.get("volunteer"), lambda v: (
        f"- {v.get('organization','')} | {v.get('position','')}：{v.get('summary','')}"
    ))
    _entries("核心能力", resume.get("skills"), lambda s: (
        f"- {s.get('name','')}：{', '.join(s.get('keywords') or [])}"
    ))
    _entries("证书", resume.get("certificates"), lambda c: (
        f"- {c.get('name','')} | {c.get('issuer','')} {c.get('date','')}"
    ))
    _entries("教育", resume.get("education"), lambda e: (
        f"- {e.get('institution','')} | {e.get('studyType','')} {e.get('area','')}"
    ))
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# criteria prompt（按 rubric 生成）
# --------------------------------------------------------------------------- #
SYSTEM = "你是严格、公平、只看证据的简历评估专家。只输出指定 JSON，不要解释、不要 markdown。"


def build_criteria_prompt(rubric: Rubric, resume_text: str) -> List[Dict[str, str]]:
    from rubrics import FAIRNESS

    cat_lines = "\n".join(
        f"### {c.label}（{c.key}，0-{c.max} 分）\n{c.bands}" for c in rubric.categories
    )
    schema_fields = ",\n        ".join(
        f'"{c.key}": {{"score": 0, "max": {c.max}, "evidence": "证据，不可为空"}}'
        for c in rubric.categories
    )
    user = f"""{rubric.position_line}。按下列维度打分，每项给出证据。

{FAIRNESS}

## 评分维度
{cat_lines}

## 加分（bonus，上限 20）
{rubric.bonus}

## 扣分（deductions）
{rubric.deductions}

## 输出（严格 JSON，字段名一字不差）
{{
    "scores": {{
        {schema_fields}
    }},
    "bonus_points": {{"total": 0, "breakdown": "字符串"}},
    "deductions": {{"total": 0, "reasons": "字符串"}},
    "key_strengths": ["1-5 条"],
    "areas_for_improvement": ["1-5 条改进建议"]
}}

## 待评估简历
{resume_text}"""
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": user},
    ]


def _parse_eval(text: str) -> Dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    obj = json.loads(text)
    if not isinstance(obj, dict) or "scores" not in obj:
        raise ValueError("评估输出缺少 scores 字段")
    return obj


def evaluate(resume: Dict[str, Any], rubric: Rubric, chat_fn: ChatFn) -> Dict[str, Any]:
    """按 rubric 评估一份简历，返回标准评估结构。"""
    messages = build_criteria_prompt(rubric, resume_to_text(resume))
    raw = chat_fn(messages)
    return _parse_eval(raw)


def make_evaluate_fn(rubric: Rubric, chat_fn: ChatFn) -> Callable[[Dict[str, Any]], Dict[str, Any]]:
    """绑定 rubric + chat_fn，得到 resume_agent.run 需要的 evaluate_fn。"""
    return lambda resume: evaluate(resume, rubric, chat_fn)
