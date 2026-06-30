"""可插拔评分 rubric。

hiring-agent 的评分标准写死给「软件工程实习生」（开源/编码导向），对产品设计师等岗位
没有意义。这里把 rubric 抽象出来：每个岗位声明自己的评分维度、加减分规则、公平性约束和
事实层缺口检查，评估器据此生成 prompt 与缺口报告。

内置两套：
- ENGINEER：对齐 hiring-agent 原四维（open_source/self_projects/production/technical_skills）。
- DESIGNER：产品/UX 设计师维度（设计功底/商业影响/流程方法/经验广度）。

所有 rubric 共用同一套输出结构（scores/bonus/deductions/key_strengths/areas_for_improvement），
因此 total_score / improver / resume_agent 无需关心具体岗位。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List


@dataclass
class Category:
    key: str        # JSON 里的字段名，如 "impact"
    label: str      # 人类可读名，如 "商业与用户影响"
    max: int
    bands: str      # 打分档位说明（喂给 LLM）


@dataclass
class Rubric:
    role: str                       # 岗位名，如 "产品设计师"
    position_line: str              # prompt 抬头，如 "评估一份产品设计师简历"
    categories: List[Category]
    bonus: str                      # 加分规则文本
    deductions: str                 # 扣分规则文本
    gap_fn: Callable[[Dict[str, Any], Dict[str, Any]], List[str]]  # (resume, evaluation)->缺口

    def total_max(self) -> int:
        return sum(c.max for c in self.categories)


# 公平性约束：所有 rubric 共用
FAIRNESS = """## 公平性（强制）
评分**绝不能**依赖：姓名、性别、年龄、毕业院校、GPA、城市/地域、任何与能力无关的个人特征。
只能基于：岗位相关的专业能力、项目复杂度与真实影响、流程与方法、可验证的成果。"""


# --------------------------------------------------------------------------- #
# 缺口检查
# --------------------------------------------------------------------------- #
def _is_http_url(v: Any) -> bool:
    return isinstance(v, str) and v.strip().lower().startswith(("http://", "https://"))


def _has_portfolio_link(resume: Dict[str, Any]) -> bool:
    """是否存在任一有效 http(s) 链接（个人站 / 主页 / 项目）。

    缺口提示用：只要有任一可点链接就不报「缺作品集链接」，避免对 network 字段措辞的脆弱依赖。
    """
    basics = resume.get("basics") or {}
    if _is_http_url(basics.get("url")):
        return True
    for p in basics.get("profiles") or []:
        if isinstance(p, dict) and _is_http_url(p.get("url")):
            return True
    for proj in resume.get("projects") or []:
        if isinstance(proj, dict) and _is_http_url(proj.get("url")):
            return True
    return False


def _engineer_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    gaps: List[str] = []
    scores = evaluation.get("scores") or {}
    if float((scores.get("open_source") or {}).get("score", 0)) <= 10:
        gaps.append(
            "开源分偏低：评分只认对【他人项目】的贡献。这是事实层缺口，"
            "需真实补充对外部仓库的 PR / issue / 维护记录，改写无法提分。"
        )
    if not resume.get("projects"):
        gaps.append("简历没有 projects 条目：需真实补充 1-3 个有链接的项目。")
    for p in resume.get("projects") or []:
        if not p.get("url"):
            gaps.append(f"项目「{p.get('name', '?')}」缺少链接：无链接会被扣分，请补真实地址。")
    return gaps


def _designer_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    gaps: List[str] = []
    if not _has_portfolio_link(resume):
        gaps.append(
            "缺作品集链接：设计岗作品集是硬通货，评分与面试都高度依赖。这是事实层缺口，"
            "需真实补充 Behance / 站酷 / Dribbble / 个人站作品集地址，改写无法替代。"
        )
    # 量化影响缺失：检查 work highlights 是否含数字
    import re
    has_number = any(
        re.search(r"\d", h or "")
        for w in resume.get("work") or []
        for h in (w.get("highlights") or [])
    )
    if not has_number:
        gaps.append(
            "成果缺量化：设计影响力评分看转化率/满意度/效率/留存等数据。如有真实数据，"
            "请补进经历；没有的话这是需要去拿的事实，改写不能编造。"
        )
    return gaps


# --------------------------------------------------------------------------- #
# 内置 rubric
# --------------------------------------------------------------------------- #
ENGINEER = Rubric(
    role="软件工程实习生",
    position_line="评估一份软件工程实习生简历",
    categories=[
        Category("open_source", "开源贡献", 35,
                 "对他人项目的真实贡献（PR/维护/GSoC）得高分；只有个人仓库 ≤10 分；无 GitHub ≤4 分。"),
        Category("self_projects", "个人项目", 30,
                 "复杂度、真实影响、架构与技术栈；教程级（todo/计算器）低分；无链接扣 30-50%。"),
        Category("production", "生产经验", 25,
                 "实习/生产/创业经历；创始人或早期工程师加分。"),
        Category("technical_skills", "技术能力", 10,
                 "技术广度、问题解决、算法与数据结构。"),
    ],
    bonus="GSoC +5；创业创始人 +3-5；早期工程师 +2-3；portfolio +2；LinkedIn +1；技术博客 +1-3。上限 20。",
    deductions="只有教程项目 -2~-5；项目无链接每个 -3~-5；全是课堂作业 -2。",
    gap_fn=_engineer_gaps,
)

DESIGNER = Rubric(
    role="产品/UX 设计师",
    position_line="评估一份产品体验设计师（UX/产品设计）简历",
    categories=[
        Category("impact", "商业与用户影响", 35,
                 "可量化的真实结果（转化率/满意度/效率/留存/用户量）权重最高；"
                 "有清晰量化且与业务挂钩 25-35；有结果但弱量化 12-24；纯职责无成果 1-9。"),
        Category("craft", "设计功底与执行", 25,
                 "视觉与交互质量、保真度、设计系统/组件库、规范化能力；"
                 "主导设计系统/高完成度作品 18-25；常规执行 8-17；仅基础切图 1-7。"),
        Category("process", "设计流程与方法", 20,
                 "用户研究、需求洞察、设计策略、数据驱动、跨团队协作（与算法/工程/业务）。"),
        Category("scope", "经验广度与复杂度", 20,
                 "0-1 从 0 到 1、跨端（Web/iOS/Android/小程序/VR）、AI/Agent 等前沿方向、行业难度。"),
    ],
    bonus="作品集链接 +3；知名公司/独角兽经历 +2；设计获奖 +3；权威设计认证 +2；"
          "AI/Agent 等前沿方向实战 +3；主导设计系统/组件库 +2；多个 0-1 项目 +2。上限 20。",
    deductions="无作品集/项目链接 -3~-5；全程无任何量化结果 -3~-5；纯职责罗列无成果 -2~-4。",
    gap_fn=_designer_gaps,
)

RUBRICS: Dict[str, Rubric] = {
    "engineer": ENGINEER,
    "designer": DESIGNER,
}


def get_rubric(name: str) -> Rubric:
    if name not in RUBRICS:
        raise ValueError(f"未知 rubric：{name}，可选 {list(RUBRICS)}")
    return RUBRICS[name]
