"""可插拔评分 rubric。

hiring-agent 的评分标准写死给「软件工程实习生」（开源/编码导向），对产品设计师等岗位
没有意义。这里把 rubric 抽象出来：每个岗位声明自己的评分维度、加减分规则、公平性约束和
事实层缺口检查，评估器据此生成 prompt 与缺口报告。

内置五套：ENGINEER（对齐 hiring-agent 原四维）、DESIGNER、PM、DATA、MARKETING。

所有 rubric 共用同一套输出结构（scores/bonus/deductions/key_strengths/areas_for_improvement），
因此 total_score / improver / resume_agent 无需关心具体岗位。
"""

from __future__ import annotations

import re
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
    """合法 http(s) URL：scheme 为 http(s) 且有非空 netloc（排除 `https://` 这类空壳）。"""
    if not isinstance(v, str):
        return False
    try:
        from urllib.parse import urlparse
        u = urlparse(v.strip())
        return u.scheme in ("http", "https") and bool(u.netloc)
    except Exception:
        return False


def _dicts(resume: Any, key: str) -> List[Dict[str, Any]]:
    """安全取 section 里的 dict 元素：非 dict resume / 非 list section / 非 dict 元素全忽略。"""
    if not isinstance(resume, dict):
        return []
    v = resume.get(key)
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


# 作品集平台关键词：用于把「设计/作品平台主页」与普通主页（LinkedIn 等）区分开
_PORTFOLIO_NETS = (
    "behance", "dribbble", "站酷", "zcool", "portfolio", "作品", "个人站", "personal site",
)


def _has_portfolio_link(resume: Dict[str, Any]) -> bool:
    """是否存在「作品集类」链接：个人站 / 项目案例链接 / 设计作品平台主页。

    刻意**不把** LinkedIn 等通用社交主页当作品集（否则会对设计岗造成假阴性）。
    """
    basics = resume.get("basics") if isinstance(resume, dict) else None
    basics = basics if isinstance(basics, dict) else {}
    if _is_http_url(basics.get("url")):          # 个人站通常即作品集
        return True
    for proj in _dicts(resume, "projects"):       # 项目案例链接
        if _is_http_url(proj.get("url")):
            return True
    profiles = basics.get("profiles")
    for p in (profiles if isinstance(profiles, list) else []):
        if isinstance(p, dict) and _is_http_url(p.get("url")):
            net = (p.get("network") or "").lower()
            if any(k in net for k in _PORTFOLIO_NETS):
                return True
    return False


# 量化影响：数字 + 指标单位/百分比（排除纯年份/版本号/团队人数等）
_IMPACT_RE = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|％|万|亿|倍|分|元|美元|次|w|k|x|\+)"
)


def _impact_texts(resume: Dict[str, Any]) -> List[str]:
    """收集成果类字段文本（summary/highlights/description），不扫日期/联系方式。"""
    out: List[str] = []
    for sec in ("work", "volunteer"):
        for it in _dicts(resume, sec):
            if isinstance(it.get("summary"), str):
                out.append(it["summary"])
            out += [h for h in (it.get("highlights") or []) if isinstance(h, str)]
    for p in _dicts(resume, "projects"):
        if isinstance(p.get("description"), str):
            out.append(p["description"])
        out += [h for h in (p.get("highlights") or []) if isinstance(h, str)]
    return out


def _safe_score(evaluation: Any, key: str):
    """安全取某维度得分；缺失/非 dict/非有限数 -> None（无法判断，不当 0 误报）。"""
    scores = evaluation.get("scores") if isinstance(evaluation, dict) else None
    cat = scores.get(key) if isinstance(scores, dict) else None
    v = cat.get("score") if isinstance(cat, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _engineer_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    gaps: List[str] = []
    os_score = _safe_score(evaluation, "open_source")
    if os_score is not None and os_score <= 10:
        gaps.append(
            "开源分偏低：评分只认对【他人项目】的贡献。这是事实层缺口，"
            "需真实补充对外部仓库的 PR / issue / 维护记录，改写无法提分。"
        )
    projects = _dicts(resume, "projects")
    if not projects:
        gaps.append("简历没有 projects 条目：需真实补充 1-3 个有链接的项目。")
    for p in projects:
        if not _is_http_url(p.get("url")):
            gaps.append(f"项目「{p.get('name', '?')}」缺少有效链接：无链接会被扣分，请补真实地址。")
    return gaps


def _has_quantified_impact(resume: Dict[str, Any]) -> bool:
    """成果字段里是否出现「数字 + 指标单位/百分比」（排除年份/版本/团队人数等噪声）。"""
    return any(_IMPACT_RE.search(t) for t in _impact_texts(resume))


def _quant_gap(resume: Dict[str, Any], metric_hint: str) -> List[str]:
    if _has_quantified_impact(resume):
        return []
    return [
        f"成果缺量化：该岗位影响力评分看{metric_hint}等数据。如有真实数据请补进经历；"
        "没有的话这是需要去拿的事实，改写不能编造。"
    ]


def _portfolio_gap(resume: Dict[str, Any]) -> List[str]:
    if _has_portfolio_link(resume):
        return []
    return [
        "缺作品集链接：设计岗作品集是硬通货，评分与面试都高度依赖。这是事实层缺口，"
        "需真实补充 Behance / 站酷 / Dribbble / 个人站作品集地址，改写无法替代。"
    ]


def _designer_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    return _portfolio_gap(resume) + _quant_gap(resume, "转化率/满意度/效率/留存")


def _pm_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    return _quant_gap(resume, "增长/收入/留存/转化/DAU")


def _data_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    gaps = _quant_gap(resume, "业务收益/转化提升/成本下降/模型效果")
    # 要求至少一个「结构合法且有内容（名称或有效链接）」的项目，空壳项目不算
    has_real_project = any(
        p.get("name") or _is_http_url(p.get("url")) for p in _dicts(resume, "projects")
    )
    if not (_has_portfolio_link(resume) or has_real_project):
        gaps.append(
            "缺分析作品/项目：数据岗看可验证的分析或建模产出。建议补 GitHub / Kaggle / "
            "分析报告链接，或在简历中补 1-2 个有方法与结论的项目。"
        )
    return gaps


def _marketing_gaps(resume: Dict[str, Any], evaluation: Dict[str, Any]) -> List[str]:
    return _quant_gap(resume, "拉新/转化率/ROI/留存/GMV")


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
    bonus="作品集链接 +3；大规模/高复杂度业务的可验证责任与成果 +2；设计获奖 +3；权威设计认证 +2；"
          "AI/Agent 等前沿方向实战 +3；主导设计系统/组件库 +2；多个 0-1 项目 +2。上限 20。",
    deductions="无作品集/项目链接 -3~-5；全程无任何量化结果 -3~-5；纯职责罗列无成果 -2~-4。",
    gap_fn=_designer_gaps,
)

PM = Rubric(
    role="产品经理",
    position_line="评估一份产品经理简历",
    categories=[
        Category("impact", "商业与数据影响", 30,
                 "可量化的真实结果（增长/收入/留存/转化/DAU）权重最高；"
                 "有清晰量化且与业务挂钩 22-30；有结果弱量化 10-21；纯职责无成果 1-9。"),
        Category("product_sense", "产品感与判断", 30,
                 "需求洞察、优先级与取舍、用户价值定义、对问题本质的把握。"),
        Category("execution", "落地与交付", 25,
                 "推动跨团队（设计/研发/数据/业务）、上线节奏、复杂项目从 0 到 1 的交付能力。"),
        Category("strategy", "战略与视野", 15,
                 "市场与竞品理解、商业模式、长期规划与方向判断。"),
    ],
    bonus="大规模/高复杂度业务的可验证责任 +2；从 0 到 1 主导核心产品 +3；显著营收/增长贡献 +3；"
          "AI/前沿方向产品实战 +3；行业稀缺领域经验 +2。上限 20。",
    deductions="全程无任何量化结果 -3~-5；纯功能罗列无判断/取舍 -2~-4；只执行不涉决策 -2。",
    gap_fn=_pm_gaps,
)

DATA = Rubric(
    role="数据分析师 / 数据科学家",
    position_line="评估一份数据分析 / 数据科学简历",
    categories=[
        Category("technical", "技术能力", 30,
                 "SQL/Python/统计/机器学习/数据工程与工具栈的深度与广度。"),
        Category("business_impact", "业务影响", 30,
                 "分析/模型驱动的真实决策与量化收益（转化提升/成本下降/营收/留存）权重最高。"),
        Category("rigor", "分析严谨性", 20,
                 "方法论、实验/AB 设计、因果推断、指标体系、结论的可靠性。"),
        Category("communication", "沟通与落地", 20,
                 "数据可视化、向业务讲清洞察、推动决策与行动落地的能力。"),
    ],
    bonus="高影响分析直接驱动业务决策 +3；主导指标体系/数据产品 +2；Kaggle/竞赛成绩 +2；"
          "因果/实验方法扎实 +2；AI/大模型相关数据工作 +3。上限 20。",
    deductions="只有工具罗列无业务结果 -3~-5；无任何量化收益 -3~-5；分析无方法/结论 -2~-4。",
    gap_fn=_data_gaps,
)

MARKETING = Rubric(
    role="市场 / 增长",
    position_line="评估一份市场 / 增长（Marketing/Growth）简历",
    categories=[
        Category("growth_impact", "增长与转化", 35,
                 "拉新/留存/转化/ROI/GMV 的真实量化结果权重最高；"
                 "有清晰量化且归因可信 25-35；有结果弱量化 12-24；纯活动罗列无效果 1-9。"),
        Category("channel", "渠道与打法", 25,
                 "渠道运营、投放/买量、内容、SEO/SEM、私域/社群等打法的深度。"),
        Category("creative", "创意与内容", 20,
                 "内容创作、品牌塑造、活动/campaign 策划的质量与影响。"),
        Category("data_driven", "数据驱动", 20,
                 "漏斗分析、AB 测试、归因模型、用数据迭代增长策略的能力。"),
    ],
    bonus="带来显著营收/用户增长 +3；操盘爆款活动/campaign +3；多渠道实战 +2；"
          "数据驱动增长方法扎实 +2；AI/新媒体前沿打法 +2。上限 20。",
    deductions="全程无任何量化效果 -3~-5；只罗列活动不谈结果 -2~-4；无渠道/数据方法 -2。",
    gap_fn=_marketing_gaps,
)

RUBRICS: Dict[str, Rubric] = {
    "engineer": ENGINEER,
    "designer": DESIGNER,
    "pm": PM,
    "data": DATA,
    "marketing": MARKETING,
}


def get_rubric(name: str) -> Rubric:
    if name not in RUBRICS:
        raise ValueError(f"未知 rubric：{name}，可选 {list(RUBRICS)}")
    return RUBRICS[name]


def _self_check() -> None:
    """注册自检：用显式 raise（不用 assert，避免 python -O 被剥离）。

    校验：registry 值是 Rubric、role 非空且唯一、categories 非空、key 唯一且为非空字符串、
    max 为正整数（非 bool）、gap_fn 可调用、各 rubric 维度满分一致（保证报告 /120 通用）。
    """
    seen_roles = set()
    for name, r in RUBRICS.items():
        if not isinstance(r, Rubric):
            raise TypeError(f"{name} 不是 Rubric")
        if not (isinstance(r.role, str) and r.role.strip()):
            raise ValueError(f"{name} role 不能为空")
        if r.role in seen_roles:
            raise ValueError(f"role 重复：{r.role}")
        seen_roles.add(r.role)
        if not callable(r.gap_fn):
            raise ValueError(f"{name} gap_fn 不可调用")
        if not r.categories:
            raise ValueError(f"{name} categories 不能为空")
        keys = [c.key for c in r.categories]
        if len(keys) != len(set(keys)):
            raise ValueError(f"{name} 类别 key 不唯一")
        for c in r.categories:
            if not (isinstance(c.key, str) and c.key.strip()):
                raise ValueError(f"{name} 类别 key 须为非空字符串")
            if not (isinstance(c.max, int) and not isinstance(c.max, bool) and c.max > 0):
                raise ValueError(f"{name}.{c.key} max 须为正整数")
        if r.total_max() != 100:
            raise ValueError(f"{name} 维度满分应为 100（实际 {r.total_max()}）")


_self_check()
