"""jd_match.py 离线测试（假 chat_fn，重点验证 grounding 反造假）。"""

import json

import jd_match as jm

RESUME = {
    "basics": {"name": "张三", "summary": "5 年 UX 设计经验，做过 Agent 与多模态设计"},
    "work": [{"name": "某公司", "position": "设计师",
              "highlights": ["主导设计系统搭建，设计效率提升 40%",
                             "小V联盟移动端 0-1 设计，投诉率下降 80%"]}],
    "skills": [{"name": "设计工具", "keywords": ["Figma", "组件库"]}],
}

REQS = [
    {"text": "5 年以上 UX 设计经验", "category": "experience", "importance": "must"},
    {"text": "精通 Figma 与设计系统", "category": "skill", "importance": "must"},
    {"text": "有 AI 产品设计经验", "category": "experience", "importance": "nice"},
    {"text": "有大规模 C 端用户增长经验", "category": "experience", "importance": "must"},
]


def test_extract_requirements():
    raw = [
        {"text": "5 年 UX 经验", "category": "experience", "importance": "must"},
        {"text": "会 Figma", "category": "skill", "importance": "nice"},
        {"bad": "忽略"},  # 无 text -> 丢弃
    ]
    chat = lambda m: json.dumps(raw, ensure_ascii=False)
    reqs = jm.extract_requirements("JD 文本", chat)
    assert len(reqs) == 2 and reqs[0]["importance"] == "must"
    print("OK: JD 抽要求（丢弃非法项）")


def test_match_grounded_evidence_kept():
    """证据真在简历里 -> covered 保留。"""
    matches = [
        {"coverage": "covered", "evidence": "5 年 UX 设计经验", "suggestion": ""},
        {"coverage": "covered", "evidence": "Figma", "suggestion": ""},
        {"coverage": "partial", "evidence": "Agent 与多模态设计", "suggestion": "补 AI 量化成果"},
        {"coverage": "missing", "evidence": "", "suggestion": "补增长数据"},
    ]
    chat = lambda m: json.dumps(matches, ensure_ascii=False)
    rep = jm.match_requirements(REQS, RESUME, chat)
    assert rep.matches[0]["coverage"] == "covered" and rep.matches[0]["grounded"]
    assert rep.matches[2]["coverage"] == "partial"
    assert rep.summary["covered"] == 2 and rep.summary["partial"] == 1
    assert not rep.warnings
    print("OK: 真证据保留 covered/partial")


def test_match_fabricated_evidence_downgraded():
    """LLM 谎报 covered 但证据不在简历 -> 降级 missing + 告警（反造假核心）。"""
    matches = [
        {"coverage": "covered", "evidence": "10 年大厂 P8 经验", "suggestion": ""},  # 简历里没有
        {"coverage": "missing", "evidence": "", "suggestion": ""},
        {"coverage": "missing", "evidence": "", "suggestion": ""},
        {"coverage": "covered", "evidence": "服务 1 亿用户增长", "suggestion": ""},   # 编造
    ]
    chat = lambda m: json.dumps(matches, ensure_ascii=False)
    rep = jm.match_requirements(REQS, RESUME, chat)
    assert rep.matches[0]["coverage"] == "missing"  # 降级
    assert rep.matches[3]["coverage"] == "missing"  # 降级
    assert len(rep.warnings) == 2
    print("OK: 谎报匹配被 grounding 降级 + 告警")


def test_grounding_tolerates_paraphrase():
    """转述过的真证据（高 bigram 重叠）应通过；凭空编造（低重叠）仍被拦。"""
    rn = jm._norm(jm.resume_to_text(RESUME))
    rs = jm._shingles(jm.resume_to_text(RESUME))
    # 真经历的轻微转述：原文「主导设计系统搭建，设计效率提升 40%」
    assert jm._grounded("主导设计系统搭建，效率提升 40%", rn, rs)        # 转述，高重叠
    assert jm._grounded("小V联盟移动端 0-1 设计", rn, rs)                # 原文精确
    # 编造：与简历几乎不重叠
    assert not jm._grounded("曾任谷歌 P9 带 50 人团队", rn, rs)
    print("OK: grounding 容转述、拦编造")


def test_must_have_gaps_and_coverage_pct():
    matches = [
        {"coverage": "covered", "evidence": "5 年 UX 设计经验", "suggestion": ""},
        {"coverage": "covered", "evidence": "Figma", "suggestion": ""},
        {"coverage": "partial", "evidence": "Agent 与多模态设计", "suggestion": ""},
        {"coverage": "missing", "evidence": "", "suggestion": ""},  # must 缺口
    ]
    chat = lambda m: json.dumps(matches, ensure_ascii=False)
    rep = jm.match_requirements(REQS, RESUME, chat)
    # 覆盖度 = (2 + 0.5*1)/4 = 62.5 -> 62 或 63
    assert 60 <= rep.summary["coverage_pct"] <= 65
    assert "大规模 C 端用户增长" in rep.summary["must_have_gaps"][0]
    print(f"OK: must 缺口 + 覆盖度 {rep.summary['coverage_pct']}%")


def test_report_renders():
    chat = lambda m: json.dumps(
        [{"coverage": "missing", "evidence": "", "suggestion": "补"} for _ in REQS],
        ensure_ascii=False)
    rep = jm.match_requirements(REQS, RESUME, chat)
    txt = jm.format_match_report(rep)
    assert "JD 匹配报告" in txt and "覆盖度" in txt and "硬性缺口" in txt
    print("OK: 报告渲染")


def test_empty_jd_rejected():
    try:
        jm.extract_requirements("  ", lambda m: "[]")
        assert False
    except ValueError:
        pass
    print("OK: 空 JD 拒绝")


if __name__ == "__main__":
    test_extract_requirements()
    test_match_grounded_evidence_kept()
    test_match_fabricated_evidence_downgraded()
    test_grounding_tolerates_paraphrase()
    test_must_have_gaps_and_coverage_pct()
    test_report_renders()
    test_empty_jd_rejected()
    print("\nALL PASS")
