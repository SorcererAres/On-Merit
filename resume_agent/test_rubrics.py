"""rubrics.py + evaluate.py 离线测试（可插拔评分 / 设计师维度）。"""

import json

import rubrics
import evaluate as ev
from improver import fact_gap_report, total_score


DESIGNER_RESUME = {
    "basics": {"name": "张三", "summary": "5 年 UX 设计经验"},
    "work": [{"name": "某公司", "position": "设计师",
              "highlights": ["满意度提升 36.5%", "效率提升 40%"]}],
    "skills": [{"name": "设计系统"}],
}


def _fake_designer_eval(chat_fn_unused=None):
    return {
        "scores": {
            "impact": {"score": 28, "max": 35, "evidence": "量化结果丰富"},
            "craft": {"score": 18, "max": 25, "evidence": "主导设计系统"},
            "process": {"score": 14, "max": 20, "evidence": "跨团队协作"},
            "scope": {"score": 15, "max": 20, "evidence": "0-1 + 跨端"},
        },
        "bonus_points": {"total": 5, "breakdown": "AI 方向 +3 设计系统 +2"},
        "deductions": {"total": 0, "reasons": ""},
        "key_strengths": ["量化影响力强"],
        "areas_for_improvement": ["补作品集链接"],
    }


def test_designer_rubric_shape():
    r = rubrics.get_rubric("designer")
    keys = [c.key for c in r.categories]
    assert keys == ["impact", "craft", "process", "scope"]
    assert r.total_max() == 100  # +20 bonus = 120，与工程师一致
    print("OK: designer rubric 维度与满分")


def test_all_rubrics_registered_and_consistent():
    """所有岗位 rubric 满分一致 100、key 唯一（_self_check 已在 import 时跑过）。"""
    expect = {"engineer", "designer", "pm", "data", "marketing"}
    assert set(rubrics.RUBRICS) == expect
    for name in expect:
        r = rubrics.get_rubric(name)
        assert r.total_max() == 100
        keys = [c.key for c in r.categories]
        assert len(keys) == len(set(keys))
    print(f"OK: {len(expect)} 个岗位 rubric 注册且满分一致")


def test_new_role_gaps():
    """新增岗位的事实缺口：无量化成果触发量化缺口；数据岗额外要分析作品。"""
    no_num = {"basics": {"name": "X"}, "work": [{"highlights": ["负责相关工作"]}]}
    for role, hint in [("pm", "增长"), ("data", "业务收益"), ("marketing", "ROI")]:
        r = rubrics.get_rubric(role)
        ev_dummy = {"scores": {c.key: {"score": 1, "max": c.max, "evidence": "x"}
                               for c in r.categories}}
        gaps = fact_gap_report(no_num, ev_dummy, r)
        assert any("量化" in g for g in gaps), f"{role} 应报量化缺口"
    # 数据岗无项目/作品 -> 额外缺口
    data_gaps = fact_gap_report(no_num, {"scores": {}}, rubrics.get_rubric("data"))
    assert any("分析作品" in g for g in data_gaps)
    # 有量化则不报量化缺口
    quant = {"basics": {"name": "X"}, "work": [{"highlights": ["转化率提升 30%"]}]}
    assert not any("量化" in g for g in fact_gap_report(quant, {"scores": {}}, rubrics.get_rubric("pm")))
    print("OK: pm/data/marketing 事实缺口")


def test_total_score_role_agnostic():
    # 28+18+14+15 + 5 - 0 = 80
    assert total_score(_fake_designer_eval()) == 80.0
    print("OK: total_score 对设计师维度通用")


def test_designer_gaps_fire_portfolio():
    """设计师无作品集链接 -> 触发作品集缺口；不触发工程师的开源缺口。"""
    r = rubrics.get_rubric("designer")
    gaps = fact_gap_report(DESIGNER_RESUME, _fake_designer_eval(), r)
    assert any("作品集链接" in g for g in gaps)
    assert not any("开源" in g for g in gaps)
    print("OK: 设计师缺口（作品集），无开源误报")


def test_designer_quant_gap():
    """无任何量化成果 -> 触发量化缺口。"""
    r = rubrics.get_rubric("designer")
    no_num = {"basics": {"name": "X", "url": "https://x.com"},
              "work": [{"highlights": ["负责设计工作"]}]}
    gaps = fact_gap_report(no_num, _fake_designer_eval(), r)
    assert any("量化" in g for g in gaps)
    print("OK: 量化缺口触发")


def test_designer_with_portfolio_no_gap():
    r = rubrics.get_rubric("designer")
    withlink = {"basics": {"name": "X", "url": "https://x.com"},
                "work": [{"highlights": ["满意度提升 36.5%"]}]}
    assert fact_gap_report(withlink, _fake_designer_eval(), r) == []
    print("OK: 有作品集+量化 -> 无缺口")


def test_engineer_default_gaps_no_designer_falsefire():
    """无 rubric 时默认工程师逻辑；但 scores 无 open_source 不再误报开源缺口。"""
    gaps = fact_gap_report({"projects": [{"name": "P", "url": "x"}]}, _fake_designer_eval())
    assert not any("开源" in g for g in gaps)  # 评估里没有 open_source 维度
    print("OK: 默认分支不对非工程评估误报开源")


def test_evaluate_parses_llm_json():
    """evaluate 用 rubric + 假 LLM，解析为标准结构。"""
    r = rubrics.get_rubric("designer")
    chat = lambda messages: json.dumps(_fake_designer_eval(), ensure_ascii=False)
    result = ev.evaluate(DESIGNER_RESUME, r, chat)
    assert "impact" in result["scores"]
    assert total_score(result) == 80.0
    print("OK: evaluate 解析 LLM 输出")


def test_criteria_prompt_contains_categories():
    r = rubrics.get_rubric("designer")
    msgs = ev.build_criteria_prompt(r, "简历文本")
    user = msgs[1]["content"]
    assert "商业与用户影响" in user and "impact" in user
    assert "公平性" in user and "作品集" in user
    print("OK: criteria prompt 含设计维度与公平性")


def test_resume_to_text_drops_personal_fields():
    """Codex 复核：公平性——主动删除姓名/院校/城市，不靠 prompt 约束。"""
    r = {"basics": {"name": "张三", "summary": "5 年经验", "location": {"city": "北京"}},
         "work": [{"name": "某公司", "highlights": ["满意度提升 36.5%"]}],
         "education": [{"institution": "野鸡大学", "studyType": "本科", "area": "设计"}]}
    txt = ev.resume_to_text(r)
    assert "张三" not in txt and "野鸡大学" not in txt and "北京" not in txt  # 已删
    assert "满意度提升 36.5%" in txt and "某公司" in txt and "本科" in txt    # 保留评估相关
    print("OK: resume_to_text 删除姓名/院校/城市")


def test_validate_evaluation_strict():
    """Codex 复核：评估结果按 rubric 严格校验+规范化。"""
    r = rubrics.get_rubric("designer")
    # 缺类别 -> 拒
    try:
        ev.validate_evaluation(r, {"scores": {"impact": {"score": 10, "max": 35, "evidence": "x"}}})
        assert False
    except ValueError:
        pass
    # 篡改 max + 越界分 -> max 强制回 rubric，分数夹紧
    good = _fake_designer_eval()
    good["scores"]["impact"]["max"] = 999       # 篡改
    good["scores"]["impact"]["score"] = 9999    # 越界
    norm = ev.validate_evaluation(r, good)
    assert norm["scores"]["impact"]["max"] == 35           # 服务端权威上限
    assert norm["scores"]["impact"]["score"] == 35         # 夹到 max
    # 非有限分 -> 拒
    try:
        bad = _fake_designer_eval(); bad["scores"]["craft"]["score"] = float("inf")
        ev.validate_evaluation(r, bad)
        assert False
    except ValueError:
        pass
    # 空 evidence -> 拒
    try:
        bad = _fake_designer_eval(); bad["scores"]["scope"]["evidence"] = ""
        ev.validate_evaluation(r, bad)
        assert False
    except ValueError:
        pass
    print("OK: validate_evaluation 严格校验（类别/上限/越界/非数/证据）")


def test_evaluate_runs_validation():
    """evaluate 端到端走校验：篡改的 max 被纠正。"""
    r = rubrics.get_rubric("designer")
    tampered = _fake_designer_eval(); tampered["scores"]["impact"]["max"] = 999
    chat = lambda m: json.dumps(tampered, ensure_ascii=False)
    res = ev.evaluate(DESIGNER_RESUME, r, chat)
    assert res["scores"]["impact"]["max"] == 35
    print("OK: evaluate 端到端校验")


def test_evaluate_retries_on_bad_output():
    """LLM 偶发格式抖动：校验失败重试，下一次合规则成功；全失败才抛。"""
    r = rubrics.get_rubric("designer")
    calls = {"n": 0}
    def flaky(messages):
        calls["n"] += 1
        if calls["n"] == 1:
            return "{}"  # 第一次缺 scores -> 校验失败
        return json.dumps(_fake_designer_eval(), ensure_ascii=False)
    res = ev.evaluate(DESIGNER_RESUME, r, flaky)
    assert calls["n"] == 2 and total_score(res) == 80.0

    always_bad = lambda m: "not json"
    try:
        ev.evaluate(DESIGNER_RESUME, r, always_bad, retries=1)
        assert False
    except ValueError as e:
        assert "多次不合规" in str(e)
    print("OK: 评估重试（抖动恢复 / 全失败抛）")


def test_portfolio_link_detection():
    assert rubrics._has_portfolio_link({"basics": {"url": "https://x.com"}})       # 个人站
    assert rubrics._has_portfolio_link({"projects": [{"url": "http://y.com"}]})    # 项目案例
    assert rubrics._has_portfolio_link({"basics": {"profiles": [{"network": "Behance", "url": "https://behance.net/x"}]}})
    # LinkedIn 等通用主页不算作品集（Codex 复核：避免假阴性）
    assert not rubrics._has_portfolio_link({"basics": {"profiles": [{"network": "LinkedIn", "url": "https://linkedin.com/in/x"}]}})
    assert not rubrics._has_portfolio_link({"basics": {"url": "javascript:alert(1)"}})  # 非 http
    assert not rubrics._has_portfolio_link({"basics": {"url": "https://"}})              # 空壳 URL
    print("OK: 作品集链接判断（个人站/项目/设计平台，排除 LinkedIn 与空壳）")


def test_gap_fns_robust_to_malformed():
    """Codex 复核：gap_fn / helper 不被畸形 resume / evaluation 击穿。"""
    bad_resume = {"projects": ["坏元素", None, 1], "work": "不是列表"}
    bad_eval = {"scores": {"open_source": {"score": "N/A", "max": 35}}}
    # 不抛异常
    rubrics._engineer_gaps(bad_resume, bad_eval)
    rubrics._designer_gaps(bad_resume, {"scores": None})
    rubrics._data_gaps(bad_resume, "不是dict")
    assert rubrics._has_quantified_impact({"work": 1}) is False
    assert rubrics._has_portfolio_link(["不是dict"]) is False
    print("OK: gap_fn 抗畸形输入")


def test_quantified_impact_excludes_years():
    """量化检测：年份/团队人数/版本号不算量化，% 和单位才算。"""
    assert rubrics._has_quantified_impact({"work": [{"highlights": ["转化率提升 8.76%"]}]})
    assert rubrics._has_quantified_impact({"work": [{"summary": "效率提升 5 倍"}]})
    assert not rubrics._has_quantified_impact({"work": [{"highlights": ["2024.08 入职，带 3 位同事"]}]})
    assert not rubrics._has_quantified_impact({"projects": [{"description": "v1.7.1 版本"}]})
    print("OK: 量化检测排除年份/版本/人数")


if __name__ == "__main__":
    test_designer_rubric_shape()
    test_all_rubrics_registered_and_consistent()
    test_new_role_gaps()
    test_total_score_role_agnostic()
    test_designer_gaps_fire_portfolio()
    test_designer_quant_gap()
    test_designer_with_portfolio_no_gap()
    test_engineer_default_gaps_no_designer_falsefire()
    test_evaluate_parses_llm_json()
    test_criteria_prompt_contains_categories()
    test_resume_to_text_drops_personal_fields()
    test_validate_evaluation_strict()
    test_evaluate_runs_validation()
    test_evaluate_retries_on_bad_output()
    test_portfolio_link_detection()
    test_gap_fns_robust_to_malformed()
    test_quantified_impact_excludes_years()
    print("\nALL PASS")
