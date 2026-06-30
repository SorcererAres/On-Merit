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


def test_resume_to_text():
    txt = ev.resume_to_text(DESIGNER_RESUME)
    assert "张三" in txt and "满意度提升 36.5%" in txt
    print("OK: resume_to_text")


if __name__ == "__main__":
    test_designer_rubric_shape()
    test_total_score_role_agnostic()
    test_designer_gaps_fire_portfolio()
    test_designer_quant_gap()
    test_designer_with_portfolio_no_gap()
    test_engineer_default_gaps_no_designer_falsefire()
    test_evaluate_parses_llm_json()
    test_criteria_prompt_contains_categories()
    test_resume_to_text()
    print("\nALL PASS")
