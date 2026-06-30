"""P3b：从零引导问卷 -> JSON Resume（INGEST 的备用路径）。

没有现成简历 PDF 时，通过结构化提问生成初始 JSON Resume，再喂给闭环。

- ``build_resume(...)``：纯构建器，把结构化答案拼成 JSON Resume（离线可测）。
- ``interactive(input_fn, print_fn)``：命令行问答，input_fn 可注入以便测试。

只采集评分真正用到的字段，避免冗长。事实诚信：问卷只记录用户**自述的真实信息**，
不做任何编造；空字段直接省略。
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional


def _clean_list(items: List[str]) -> List[str]:
    return [x.strip() for x in items if x and x.strip()]


def build_resume(
    *,
    name: str,
    role: Optional[str] = None,
    email: Optional[str] = None,
    website: Optional[str] = None,
    city: Optional[str] = None,
    github: Optional[str] = None,
    summary: Optional[str] = None,
    work: Optional[List[Dict[str, Any]]] = None,
    projects: Optional[List[Dict[str, Any]]] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    education: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """把结构化答案拼成 JSON Resume。空字段省略。

    work[i]: {name, position, startDate, endDate, summary, highlights[]}
    projects[i]: {name, url, description, technologies[]}
    skills[i]: {name, keywords[]}
    education[i]: {institution, studyType, area, score, startDate, endDate}
    """
    basics: Dict[str, Any] = {"name": name}
    if email:
        basics["email"] = email
    if website:
        basics["url"] = website if website.startswith("http") else f"https://{website}"
    if summary:
        basics["summary"] = summary
    if city:
        basics["location"] = {"city": city}
    if github:
        basics["profiles"] = [
            {"network": "GitHub", "username": github, "url": f"https://github.com/{github}"}
        ]
    # role 不是 JSON Resume 标准字段，放进 meta 供适配层 --role 使用
    resume: Dict[str, Any] = {"basics": basics}
    if role:
        resume["meta"] = {"role": role}
    if work:
        resume["work"] = work
    if projects:
        resume["projects"] = projects
    if skills:
        resume["skills"] = skills
    if education:
        resume["education"] = education
    return resume


# --------------------------------------------------------------------------- #
# 交互模式（input_fn / print_fn 可注入，便于测试）
# --------------------------------------------------------------------------- #
def interactive(
    input_fn: Callable[[str], str] = input,
    print_fn: Callable[[str], None] = print,
) -> Dict[str, Any]:
    def ask(q: str, required: bool = False) -> str:
        while True:
            v = input_fn(f"{q}: ").strip()
            if v or not required:
                return v
            print_fn("  （此项必填）")

    def ask_list(q: str) -> List[str]:
        print_fn(f"{q}（每行一条，空行结束）：")
        out: List[str] = []
        while True:
            v = input_fn("  - ").strip()
            if not v:
                break
            out.append(v)
        return out

    print_fn("=== Resume Agent 引导问卷（直接回车跳过非必填项）===")
    name = ask("姓名", required=True)
    role = ask("岗位定位（如 AI 工程师）")
    email = ask("邮箱")
    website = ask("个人网站")
    city = ask("城市")
    github = ask("GitHub 用户名")
    summary = ask("一句话简介")

    work: List[Dict[str, Any]] = []
    print_fn("\n--- 工作经历（公司名留空结束）---")
    while True:
        company = ask("公司")
        if not company:
            break
        work.append(
            {
                "name": company,
                "position": ask("职位"),
                "startDate": ask("起始年份"),
                "endDate": ask("结束年份（在职填 至今）"),
                "summary": ask("一句话职责"),
                "highlights": _clean_list(ask_list("量化成果")),
            }
        )

    projects: List[Dict[str, Any]] = []
    print_fn("\n--- 项目（项目名留空结束）---")
    while True:
        pname = ask("项目名")
        if not pname:
            break
        projects.append(
            {
                "name": pname,
                "url": ask("链接（GitHub / Live Demo）"),
                "description": ask("一句话描述"),
                "technologies": _clean_list(
                    [t for t in ask("技术栈（逗号分隔）").split(",")]
                ),
            }
        )

    skills: List[Dict[str, Any]] = []
    print_fn("\n--- 核心能力（能力名留空结束）---")
    while True:
        sname = ask("能力名")
        if not sname:
            break
        skills.append(
            {"name": sname, "keywords": _clean_list(ask("关键词（逗号分隔）").split(","))}
        )

    education: List[Dict[str, Any]] = []
    print_fn("\n--- 教育（学校留空结束）---")
    while True:
        school = ask("学校")
        if not school:
            break
        education.append(
            {
                "institution": school,
                "studyType": ask("学历"),
                "area": ask("专业"),
                "score": ask("GPA / 成绩"),
                "startDate": ask("入学年份"),
                "endDate": ask("毕业年份"),
            }
        )

    return build_resume(
        name=name, role=role, email=email, website=website, city=city,
        github=github, summary=summary, work=work, projects=projects,
        skills=skills, education=education,
    )


def main() -> None:
    import argparse
    import json
    from pathlib import Path

    ap = argparse.ArgumentParser(description="引导问卷 -> JSON Resume")
    ap.add_argument("-o", "--out", required=True, help="输出 resume.json 路径")
    args = ap.parse_args()
    resume = interactive()
    Path(args.out).write_text(
        json.dumps(resume, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nOK: 已生成 -> {args.out}")


if __name__ == "__main__":
    main()
