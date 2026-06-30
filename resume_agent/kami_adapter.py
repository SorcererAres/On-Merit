"""P0 适配层：JSON Resume -> Kami resume 模板 -> HTML / PDF。

设计要点
--------
Kami 的 ``assets/templates/resume.html`` 使用 ``{{中文描述}}`` 形式的「自由占位符」，
这些占位符是给 agent「理解后填写」用的，会大量重复、并非唯一键，无法机械 replace。
因此本适配层不直接替换模板正文，而是：

1. 复用 Kami 模板的 ``<head>`` + ``<style>``（即整套排版 token 与 CSS class），
   保证输出和 Kami 源模板视觉一致、且随源模板自动同步；
2. 用 JSON Resume 数据按 Kami 的 CSS class **程序化拼装** ``<body>`` 各 section；
3. 有数据才渲染对应 section，无数据则省略（Kami 独有的 metrics / 叙事 section 默认跳过）。

这样得到一条确定性、可重复、无需 LLM 的「评分 -> 渲染」渲染路径（方案中的 RENDER 阶段）。

用法
----
    python kami_adapter.py resume.json -o out.pdf          # 有 weasyprint 则出 PDF
    python kami_adapter.py resume.json -o out.html         # 否则出 HTML
    python kami_adapter.py resume.json --lang en -o out.html
"""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

# Kami 仓库相对本文件的位置：../Kami
KAMI_ROOT = Path(__file__).resolve().parent.parent / "Kami"
TEMPLATE_BY_LANG = {
    "zh": "resume.html",
    "en": "resume-en.html",
    "ko": "resume-ko.html",
}

# 多语言文案表：section 标题 + 行内标签。正文不再硬编码中文（P5b）。
LABELS = {
    "zh": {
        "summary": "个人简介", "work": "工作经历", "volunteer": "志愿经历",
        "projects": "项目 & 开源", "skills": "核心能力", "certificates": "证书",
        "publications": "发表 & 出版", "awards": "荣誉奖项", "languages": "语言",
        "education": "教育背景", "duty": "职责", "result": "成果", "present": "至今",
    },
    "en": {
        "summary": "Summary", "work": "Experience", "volunteer": "Volunteer",
        "projects": "Projects & Open Source", "skills": "Skills", "certificates": "Certificates",
        "publications": "Publications", "awards": "Awards", "languages": "Languages",
        "education": "Education", "duty": "Role", "result": "Impact", "present": "Present",
    },
    "ko": {
        "summary": "소개", "work": "경력", "volunteer": "봉사",
        "projects": "프로젝트 & 오픈소스", "skills": "핵심 역량", "certificates": "자격증",
        "publications": "출판", "awards": "수상", "languages": "언어",
        "education": "학력", "duty": "역할", "result": "성과", "present": "현재",
    },
}


def L(lang: str) -> Dict[str, str]:
    """取某语言的文案表，未知语言回退中文。"""
    return LABELS.get(lang, LABELS["zh"])


# --------------------------------------------------------------------------- #
# 工具函数
# --------------------------------------------------------------------------- #
def esc(value: Optional[str]) -> str:
    """HTML 转义；None / 空串 -> 空串（保留合法的 0 / False）。"""
    if value is None or value == "":
        return ""
    return html.escape(str(value), quote=True)


_SAFE_SCHEMES = ("http://", "https://", "mailto:")


def safe_url(url: Optional[str]) -> str:
    """只放行 http/https/mailto，挡掉 javascript: / data: 等可执行 scheme。

    返回 HTML 转义后的安全 URL；不安全或空则返回空串（调用方据此降级为纯文本）。
    """
    if not url:
        return ""
    u = str(url).strip()
    low = u.lower()
    if low.startswith(_SAFE_SCHEMES):
        return esc(u)
    # 无 scheme 的裸域名（如 example.com / github.com/x）补 https://
    if "//" not in low and ":" not in low and "." in low:
        return esc("https://" + u)
    return ""  # javascript:, data:, file: 等一律拒绝


def link(url: Optional[str], inner_html: str) -> str:
    """URL 安全则生成 <a>，否则降级为纯文本 inner_html。"""
    safe = safe_url(url)
    return f'<a href="{safe}">{inner_html}</a>' if safe else inner_html


def daterange(start: Optional[str], end: Optional[str], lang: str = "zh") -> str:
    """把 startDate / endDate 拼成 ``2021 - 至今`` 这类区间串（结束语本地化）。"""
    s = (start or "").strip()
    e = (end or "").strip()
    if not s and not e:
        return ""
    return f"{s} - {e or L(lang)['present']}"


# --------------------------------------------------------------------------- #
# 复用 Kami 模板的 head + style
# --------------------------------------------------------------------------- #
def load_kami_head(template_path: Path, basics: Dict[str, Any]) -> str:
    """读取 Kami 模板从开头到 ``</style>``，并把 head 里的 meta 占位符替换为真实值。

    只动 ``<title>`` / ``<meta>``，CSS 原样保留。
    """
    raw = template_path.read_text(encoding="utf-8")
    end = raw.find("</style>")
    if end == -1:
        raise ValueError(f"模板缺少 </style>：{template_path}")
    head = raw[: end + len("</style>")]

    name = basics.get("name") or "Resume"
    summary = basics.get("summary") or ""
    keywords = ""
    # head 里的占位符是唯一出现，安全替换
    head = head.replace("{{姓名}}", esc(name))
    head = head.replace("{{摘要}}", esc(summary[:120]))
    head = head.replace("{{关键词}}", esc(keywords))
    return head


# --------------------------------------------------------------------------- #
# 各 section 构建器（输入 JSON Resume 子结构，输出 HTML 片段；无数据返回 ""）
# --------------------------------------------------------------------------- #
def build_header(basics: Dict[str, Any], role: Optional[str]) -> str:
    name = esc(basics.get("name"))
    if not name:
        return ""
    contacts: List[str] = []
    if role:
        contacts.append(f'<span class="role">{esc(role)}</span>')
    if basics.get("email"):
        contacts.append(f'<span class="email">{esc(basics["email"])}</span>')
    if basics.get("phone"):
        contacts.append(f'<span class="phone">{esc(basics["phone"])}</span>')
    site = safe_url(basics.get("url"))
    if site:  # 链接文本即 URL 本身，不安全时整段不显示（避免展示无意义的危险串）
        contacts.append(f'<span class="site"><a href="{site}">{site}</a></span>')
    for prof in basics.get("profiles") or []:
        label = prof.get("network") or prof.get("username") or "link"
        if prof.get("url"):
            contacts.append(
                f'<span class="profile">{link(prof["url"], esc(label))}</span>'
            )
    loc = (basics.get("location") or {}).get("city")
    if loc:
        contacts.append(f'<span class="loc">{esc(loc)}</span>')

    sep = '<span class="sep">·</span>'
    contact_html = sep.join(contacts)
    return f"""<div class="header">
  <div class="name serif">{name}</div>
  <div class="contact">{contact_html}</div>
</div>"""


_METRIC_RE = re.compile(
    r"(?P<num>\d[\d,]*\.?\d*)\s*(?P<unit>%|万|亿|分|stars?|star|k|K|x|倍|条|名|个|\+)?"
)


def derive_metrics(resume: Dict[str, Any], limit: int = 4) -> List[Dict[str, str]]:
    """从 summary / work.highlights 抽取量化数字，填 Kami 头部数字标签。

    保守策略：只取「数字 + 单位/上下文」清晰的项，去重，最多 limit 个。
    label 取该数字所在短句去掉数字后的前若干字，作为说明。
    """
    sources: List[str] = []
    basics = resume.get("basics") or {}
    if basics.get("summary"):
        sources.append(basics["summary"])
    for w in resume.get("work") or []:
        sources.extend(w.get("highlights") or [])
    for p in resume.get("projects") or []:
        if p.get("description"):
            sources.append(p["description"])

    metrics: List[Dict[str, str]] = []
    seen: set = set()
    for text in sources:
        # 遍历所有匹配，取带单位的那一个（避免被句中无单位的裸数字截断，如「从 0 到 1」）
        for m in _METRIC_RE.finditer(text):
            if not m.group("unit"):  # 要求带单位，避免抓到无意义裸数字
                continue
            num, unit = m.group("num"), m.group("unit")
            key = (num, unit)
            if key in seen:
                continue
            seen.add(key)
            # label：取数字所在的小句（仅按标点切分，保留中文短语），去掉数字+单位
            clauses = re.split(r"[，。,.；;、]+", text)
            clause = next((c for c in clauses if num in c), text)
            label = re.sub(
                r"\d[\d,]*\.?\d*\s*[%万亿分xXkK倍条名个\+]*", "", clause
            )
            label = re.sub(r"\s+", "", label).strip()[:8]
            metrics.append(
                {"value": esc(num), "unit": esc(unit), "label": esc(label or "指标")}
            )
            break  # 每个来源最多贡献一个指标，保持多样性
        if len(metrics) >= limit:
            break
    return metrics


def build_metrics(resume: Dict[str, Any]) -> str:
    """Kami 头部数字标签。

    优先用 ``resume.meta.metrics``（用户显式指定，[{value, unit, label}]，显式优于启发式）；
    否则从简历量化数字自动派生。强信号才渲染（>=3 个），否则省略。
    """
    explicit = (resume.get("meta") or {}).get("metrics")
    if isinstance(explicit, list) and explicit:
        metrics = [
            {
                "value": esc(str(m.get("value", ""))),
                "unit": esc(str(m.get("unit", ""))),
                "label": esc(str(m.get("label", ""))),
            }
            for m in explicit[:4]
            if isinstance(m, dict)
        ]
    else:
        metrics = derive_metrics(resume, limit=4)
    if len(metrics) < 3:
        return ""
    cells = "".join(
        f'<div class="metric"><span class="metric-value serif">{m["value"]}'
        f'<span class="unit">{m["unit"]}</span></span>'
        f'<span class="metric-label">{m["label"]}</span></div>'
        for m in metrics
    )
    return f'<div class="metrics">{cells}</div>'


def build_summary(basics: Dict[str, Any], lang: str = "zh") -> str:
    summary = basics.get("summary")
    if not summary:
        return ""
    return f"""<section>
  <div class="section-title">{L(lang)['summary']}</div>
  <div class="summary">{esc(summary)}</div>
</section>"""


def _proj_block(title_html: str, kind: str, role: str, rows: List[str]) -> str:
    head = f'<span class="proj-name serif">{title_html}</span>'
    if kind:
        head += f'<span class="proj-kind">· {esc(kind)}</span>'
    if role:
        head += f'<span class="proj-role">{esc(role)}</span>'
    rows_html = "\n".join(rows)
    return f"""  <div class="project">
    <div class="proj-head">{head}</div>
    <div class="proj-lines">
{rows_html}
    </div>
  </div>"""


def _row(label: str, text_html: str) -> str:
    return (
        f'      <div class="proj-row"><div class="proj-label">{esc(label)}</div>'
        f'<div class="proj-text">{text_html}</div></div>'
    )


def build_work(work: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not work:
        return ""
    t = L(lang)
    blocks: List[str] = []
    for w in work:
        company = esc(w.get("name") or "")
        title_html = link(w.get("url"), company)
        rows: List[str] = []
        if w.get("summary"):
            rows.append(_row(t["duty"], esc(w["summary"])))
        for hl in w.get("highlights") or []:
            rows.append(_row(t["result"], esc(hl)))
        if not rows:  # 至少占一行，避免空块
            rows.append(_row(t["duty"], ""))
        blocks.append(
            _proj_block(
                title_html,
                kind=w.get("position") or "",
                role=daterange(w.get("startDate"), w.get("endDate"), lang),
                rows=rows,
            )
        )
    return f"""<section>
  <div class="section-title">{t['work']}</div>
{chr(10).join(blocks)}
</section>"""


def build_projects(projects: List[Dict[str, Any]], lang: str = "zh") -> str:
    """projects[] -> Kami 开源项目网格（os-grid）。

    从 description 里识别 ``★ 数字`` / ``stars`` 作为星标，识别不到则不显示。
    """
    if not projects:
        return ""
    items: List[str] = []
    for p in projects:
        name = esc(p.get("name") or "")
        name_html = link(p.get("url"), name)
        desc_parts: List[str] = []
        if p.get("description"):
            desc_parts.append(esc(p["description"]))
        techs = p.get("technologies") or p.get("skills") or []
        if techs:
            desc_parts.append(esc(" / ".join(techs)))
        desc = " · ".join(desc_parts)

        star_html = ""
        m = re.search(r"(?:★|stars?\D{0,3})(\d[\d,]*)", p.get("description") or "", re.I)
        if m:
            star_html = f'<span class="os-star">★ {esc(m.group(1))}</span>'

        items.append(
            f'    <div class="os-item">'
            f'<span class="os-name serif">{name_html}</span>'
            f'<span class="os-desc">{desc}</span>{star_html}</div>'
        )
    return f"""<section class="page-break">
  <div class="section-title">{esc(L(lang)['projects'])}</div>
  <div class="os-grid">
{chr(10).join(items)}
  </div>
</section>"""


def build_skills(skills: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not skills:
        return ""
    rows: List[str] = []
    for s in skills:
        label = esc(s.get("name") or "")
        body_parts: List[str] = []
        if s.get("level"):
            body_parts.append(esc(s["level"]))
        if s.get("keywords"):
            body_parts.append(esc(" · ".join(s["keywords"])))
        body = "：".join(body_parts) if body_parts else ""
        rows.append(
            f'  <div class="skill-row"><div class="skill-label">{label}</div>'
            f'<div class="skill-body">{body}</div></div>'
        )
    return f"""<section>
  <div class="section-title">{L(lang)['skills']}</div>
{chr(10).join(rows)}
</section>"""


def build_volunteer(volunteer: List[Dict[str, Any]], lang: str = "zh") -> str:
    """volunteer[] -> 复用工作经历的 project 块样式（组织 + 角色 + 成果）。"""
    if not volunteer:
        return ""
    t = L(lang)
    blocks: List[str] = []
    for v in volunteer:
        org = esc(v.get("organization") or "")
        title_html = link(v.get("url"), org)
        rows: List[str] = []
        if v.get("summary"):
            rows.append(_row(t["duty"], esc(v["summary"])))
        for hl in v.get("highlights") or []:
            rows.append(_row(t["result"], esc(hl)))
        if not rows:
            rows.append(_row(t["duty"], ""))
        blocks.append(
            _proj_block(
                title_html,
                kind=v.get("position") or "",
                role=daterange(v.get("startDate"), v.get("endDate"), lang),
                rows=rows,
            )
        )
    return f"""<section>
  <div class="section-title">{t['volunteer']}</div>
{chr(10).join(blocks)}
</section>"""


def build_certificates(certificates: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not certificates:
        return ""
    rows: List[str] = []
    for c in certificates:
        name = esc(c.get("name") or "")
        name_html = link(c.get("url"), name)
        meta = esc(" · ".join(x for x in (c.get("issuer"), c.get("date")) if x))
        line = f'<span class="strong">{name_html}</span>'
        if meta:
            line += f' <span class="sub">{meta}</span>'
        rows.append(f'  <div class="conv-card"><div class="conv-body">{line}</div></div>')
    return f"""<section>
  <div class="section-title">{L(lang)['certificates']}</div>
  <div class="convictions">
{chr(10).join(rows)}
  </div>
</section>"""


def build_publications(publications: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not publications:
        return ""
    rows: List[str] = []
    for p in publications:
        name = esc(p.get("name") or "")
        name_html = link(p.get("url"), name)
        meta = esc(" · ".join(x for x in (p.get("publisher"), p.get("releaseDate")) if x))
        line = f'<span class="strong">{name_html}</span>'
        if meta:
            line += f' <span class="sub">{meta}</span>'
        if p.get("summary"):
            line += f'<div class="proj-text">{esc(p["summary"])}</div>'
        rows.append(f'  <div class="conv-card"><div class="conv-body">{line}</div></div>')
    return f"""<section>
  <div class="section-title">{esc(L(lang)['publications'])}</div>
  <div class="convictions">
{chr(10).join(rows)}
  </div>
</section>"""


def build_languages(languages: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not languages:
        return ""
    items: List[str] = []
    for lg in languages:
        lang = esc(lg.get("language") or "")
        if not lang:
            continue
        flu = esc(lg.get("fluency") or "")
        body = f"{lang}（{flu}）" if flu else lang
        items.append(f'<span class="strong">{body}</span>')
    if not items:
        return ""
    return f"""<section class="no-break">
  <div class="section-title">{L(lang)['languages']}</div>
  <div class="os-intro">{' · '.join(items)}</div>
</section>"""


def build_education(education: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not education:
        return ""
    rows: List[str] = []
    for e in education:
        school = esc(e.get("institution") or "")
        meta_parts = [
            x
            for x in (e.get("studyType"), e.get("area"), e.get("score"))
            if x
        ]
        meta = esc(" · ".join(meta_parts))
        date = esc(daterange(e.get("startDate"), e.get("endDate"), lang))
        rows.append(
            f'  <div class="edu-row"><div>'
            f'<span class="school serif">{school}</span>'
            f'<span class="major">　· {meta}</span></div>'
            f'<div class="date">{date}</div></div>'
        )
    return f"""<section class="no-break">
  <div class="section-title">{L(lang)['education']}</div>
{chr(10).join(rows)}
</section>"""


def build_awards(awards: List[Dict[str, Any]], lang: str = "zh") -> str:
    if not awards:
        return ""
    rows: List[str] = []
    for a in awards:
        title = esc(a.get("title") or "")
        meta_parts = [x for x in (a.get("awarder"), a.get("date")) if x]
        meta = esc(" · ".join(meta_parts))
        body = esc(a.get("summary") or "")
        line = f'<span class="strong">{title}</span>'
        if meta:
            line += f' <span class="sub">{meta}</span>'
        if body:
            line += f'<div class="proj-text">{body}</div>'
        rows.append(f'  <div class="conv-card"><div class="conv-body">{line}</div></div>')
    return f"""<section>
  <div class="section-title">{L(lang)['awards']}</div>
  <div class="convictions">
{chr(10).join(rows)}
  </div>
</section>"""


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def render_html(
    resume: Dict[str, Any],
    lang: str = "zh",
    role: Optional[str] = None,
) -> str:
    """JSON Resume dict -> 完整 HTML 字符串。"""
    from validate import ensure_valid
    ensure_valid(resume)  # 入口校验：畸形结构立刻报错而非深处崩溃
    basics = resume.get("basics") or {}
    # role 降级链：显式参数 > meta.role（问卷填写） > 第一段工作的 position
    if role is None:
        role = (resume.get("meta") or {}).get("role")
    if role is None:
        work = resume.get("work") or []
        role = work[0].get("position") if work else None

    template_path = KAMI_ROOT / "assets" / "templates" / TEMPLATE_BY_LANG.get(lang, "resume.html")
    if not template_path.exists():
        raise FileNotFoundError(f"找不到 Kami 模板：{template_path}")

    head = load_kami_head(template_path, basics)

    body_sections = [
        build_header(basics, role),
        build_metrics(resume),
        build_summary(basics, lang),
        build_work(resume.get("work") or [], lang),
        build_volunteer(resume.get("volunteer") or [], lang),
        build_projects(resume.get("projects") or [], lang),
        build_skills(resume.get("skills") or [], lang),
        build_certificates(resume.get("certificates") or [], lang),
        build_publications(resume.get("publications") or [], lang),
        build_awards(resume.get("awards") or [], lang),
        build_languages(resume.get("languages") or [], lang),
        build_education(resume.get("education") or [], lang),
    ]
    body = "\n\n".join(s for s in body_sections if s)

    return f"{head}\n<body>\n{body}\n</body>\n</html>\n"


def render_pdf(html_str: str, out_path: Path, lang: str = "zh") -> bool:
    """有 weasyprint 则渲染 PDF 并返回 True；否则返回 False（不抛错）。"""
    try:
        from weasyprint import HTML
    except Exception:
        return False
    # base_url 指向模板目录，让 ../fonts 等相对路径可解析
    base = KAMI_ROOT / "assets" / "templates"
    HTML(string=html_str, base_url=str(base)).write_pdf(str(out_path))
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="JSON Resume -> Kami 简历 HTML/PDF")
    ap.add_argument("resume_json", help="JSON Resume 文件路径")
    ap.add_argument("-o", "--out", required=True, help="输出文件（.pdf 或 .html）")
    ap.add_argument("--lang", default="zh", choices=list(TEMPLATE_BY_LANG))
    ap.add_argument("--role", default=None, help="岗位定位（覆盖默认派生）")
    args = ap.parse_args()

    resume = json.loads(Path(args.resume_json).read_text(encoding="utf-8"))
    html_str = render_html(resume, lang=args.lang, role=args.role)

    out = Path(args.out)
    if out.suffix.lower() == ".pdf":
        if render_pdf(html_str, out, lang=args.lang):
            print(f"OK: 已生成 PDF -> {out}")
        else:
            # 降级：写出同名 HTML
            fallback = out.with_suffix(".html")
            fallback.write_text(html_str, encoding="utf-8")
            print(f"ERROR: 未安装 weasyprint，已降级输出 HTML -> {fallback}")
            print("       安装后可出 PDF：pip install weasyprint")
    else:
        out.write_text(html_str, encoding="utf-8")
        print(f"OK: 已生成 HTML -> {out}")


if __name__ == "__main__":
    main()
