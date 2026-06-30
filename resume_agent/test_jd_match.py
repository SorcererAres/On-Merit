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
    """逐字段 grounding：转述的真证据通过；编造/跨字段拼接被拦。"""
    fu = jm._field_units(jm.resume_to_text(RESUME))
    assert jm._grounded("主导设计系统搭建，效率提升 40%", fu)   # 转述，落在某字段
    assert jm._grounded("小V联盟移动端 0-1 设计", fu)           # 原文
    assert jm._grounded("Figma", fu)                            # 短证据精确匹配
    assert not jm._grounded("曾任谷歌 P9 带 50 人团队", fu)     # 编造
    # 跨字段拼接：两个不同字段的真片段拼一起 -> 任一单字段都不达标 -> 拦下
    assert not jm._grounded("主导设计系统搭建并服务 1 亿海外用户增长 80%", fu)
    print("OK: 逐字段 grounding（容转述、拦编造与跨字段拼接）")


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
    assert "JD 匹配报告" in txt and "证据覆盖指数" in txt and "硬性风险" in txt
    print("OK: 报告渲染")


def test_partial_must_is_risk():
    """证据弱的 must 要求也算硬性风险（不只 missing）。"""
    matches = [
        {"coverage": "covered", "evidence": "5 年 UX 设计经验", "suggestion": ""},
        {"coverage": "partial", "evidence": "Figma", "suggestion": ""},  # must + partial -> 风险
        {"coverage": "missing", "evidence": "", "suggestion": ""},
        {"coverage": "missing", "evidence": "", "suggestion": ""},
    ]
    chat = lambda m: json.dumps(matches, ensure_ascii=False)
    rep = jm.match_requirements(REQS, RESUME, chat)
    risks = {r["text"]: r["coverage"] for r in rep.summary["must_risks"]}
    assert "精通 Figma 与设计系统" in risks and risks["精通 Figma 与设计系统"] == "partial"
    assert rep.summary["must_total"] == 3 and rep.summary["must_covered"] == 1
    print("OK: partial-must 计入硬性风险")


def test_match_length_mismatch_retries():
    """匹配项数少于要求数 -> 重试，仍不足则抛（不静默补 missing）。"""
    chat = lambda m: json.dumps([{"coverage": "covered", "evidence": "5 年 UX 设计经验"}])  # 只 1 条
    try:
        jm.match_requirements(REQS, RESUME, chat, retries=1)
        assert False
    except ValueError as e:
        assert "多次失败" in str(e)
    print("OK: 匹配项数不足触发重试/失败")


def _report_with(coverages):
    """构造一个 MatchReport（指定每条要求的 coverage）。"""
    matches = [{"coverage": c, "evidence": "", "suggestion": "", "grounded": False} for c in coverages]
    return jm.MatchReport(REQS, matches, {"must_have_gaps": ["大规模 C 端用户增长"]})


def test_improve_for_jd_strengthens_partial():
    """对 partial 项做 patch 改写：合法补丁应用，结构字段改不动。"""
    rep = _report_with(["covered", "covered", "partial", "missing"])
    def chat(m):
        return json.dumps([
            {"path": "basics.summary", "text": "资深 UX 设计师，深耕 AI 多模态全链路。"},  # 合法（字段存在）
            {"path": "work[0].name", "text": "谷歌"},                                     # 越权 -> 拒
        ], ensure_ascii=False)
    res = jm.improve_for_jd(RESUME, rep, chat)
    assert "basics.summary" in res.applied
    assert res.resume["work"][0]["name"] == "某公司"          # 公司名没动
    assert "大规模 C 端用户增长" in res.must_supplements[0]   # 缺失 must -> 需真实补充
    print("OK: JD 弱项强化 + 结构不可篡改 + 缺失项需补充")


def test_improve_for_jd_new_number_reverts():
    """改写引入原文没有的数字 -> 整体回退（反造假）。"""
    rep = _report_with(["partial", "missing", "missing", "missing"])
    chat = lambda m: json.dumps([{"path": "basics.summary", "text": "服务 9999 万用户。"}], ensure_ascii=False)
    res = jm.improve_for_jd(RESUME, rep, chat)
    assert res.applied == [] and res.resume == RESUME       # 回退
    assert any("9999" in n for n in res.notes)
    print("OK: JD 改写凭空数字被回退")


def test_improve_for_jd_no_partial():
    """没有 partial 项 -> 不改写，只提示缺失项需补充。"""
    rep = _report_with(["covered", "covered", "missing", "missing"])
    res = jm.improve_for_jd(RESUME, rep, lambda m: "[]")
    assert res.applied == [] and res.resume == RESUME
    print("OK: 无弱项不改写")


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
    test_partial_must_is_risk()
    test_match_length_mismatch_retries()
    test_improve_for_jd_strengthens_partial()
    test_improve_for_jd_new_number_reverts()
    test_improve_for_jd_no_partial()
    test_empty_jd_rejected()
    print("\nALL PASS")
