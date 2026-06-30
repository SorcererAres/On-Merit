"""improver.py 离线测试：用假 chat_fn 验证反造假逻辑，无需真实 LLM。"""

import copy
import json
from pathlib import Path

from improver import (
    improve,
    total_score,
    weakest_categories,
    validate_no_fabrication,
    fact_gap_report,
)

RESUME = json.loads((Path(__file__).parent / "sample_resume.json").read_text("utf-8"))

# 一份典型评估：production 偏弱、open_source 很低（全是个人项目）
EVAL = {
    "scores": {
        "open_source": {"score": 6, "max": 35, "evidence": "全是个人仓库，无对外贡献"},
        "self_projects": {"score": 22, "max": 30, "evidence": "项目有链接和技术栈"},
        "production": {"score": 12, "max": 25, "evidence": "职责描述偏笼统，缺量化"},
        "technical_skills": {"score": 8, "max": 10, "evidence": "技术广度可以"},
    },
    "bonus_points": {"total": 2, "breakdown": "portfolio +2"},
    "deductions": {"total": 0, "reasons": ""},
    "key_strengths": ["从 0 到 1 经验"],
    "areas_for_improvement": ["工作职责改成量化结果", "补充对外开源贡献"],
}


def test_scoring():
    # 6 + 22 + 12 + 8 + 2 - 0 = 50
    assert total_score(EVAL) == 50.0
    assert weakest_categories(EVAL)[0] == "open_source"  # 6/35 最低
    print("OK: 评分与排序")


def test_total_score_clamped_and_robust():
    """Codex 复核：巨额扣分不再变负数；非数/越界值容错；夹到 [0, 满分和+20]。"""
    huge_ded = {"scores": {"a": {"score": 5, "max": 10}},
                "bonus_points": {"total": 0}, "deductions": {"total": 999}}
    assert total_score(huge_ded) == 0.0  # 不再 -994
    # bonus 越界 + 非数分数容错
    weird = {"scores": {"a": {"score": "x", "max": 10}, "b": {"score": 10, "max": 10}},
             "bonus_points": {"total": float("inf")}, "deductions": {"total": "y"}}
    s = total_score(weird)
    assert 0.0 <= s <= 40.0  # 两类满分 20 + bonus 上限 20
    print("OK: total_score 夹紧且抗非数")


def test_gap_report():
    gaps = fact_gap_report(RESUME, EVAL)
    assert any("开源分偏低" in g for g in gaps)
    print(f"OK: 事实层缺口 {len(gaps)} 条")


def test_legit_rewrite_accepted():
    """合法改写：只改文字、不动实体和数字 -> 接受。"""
    def fake_chat(messages):
        r = copy.deepcopy(RESUME)
        # 把职责改写得更紧凑（不引入新公司、新数字）
        r["work"][0]["summary"] = "主导 Agent 编排平台从架构到上线的核心链路。"
        return json.dumps(r, ensure_ascii=False)

    res = improve(RESUME, EVAL, fake_chat)
    assert res.accepted is True
    assert not any(v.severity == "error" for v in res.violations)
    assert "主导 Agent 编排平台" in res.resume["work"][0]["summary"]
    print("OK: 合法改写被接受")


def test_fabricated_company_rejected():
    """虚构：新增一段工作经历 -> 拒绝、回退原简历。"""
    def fake_chat(messages):
        r = copy.deepcopy(RESUME)
        r["work"].append(
            {"name": "谷歌", "position": "工程师", "startDate": "2020", "endDate": "2023"}
        )
        return json.dumps(r, ensure_ascii=False)

    res = improve(RESUME, EVAL, fake_chat)
    assert res.accepted is False
    assert any(v.kind in ("new_entity", "more_items") for v in res.violations)
    # 回退：原简历只有 1 段工作
    assert len(res.resume["work"]) == 1
    print("OK: 虚构公司被拦截并回退")


def test_fabricated_number_rejected_by_default():
    """凭空数字默认判 error 并回退；--allow-new-numbers 时降级为 warn 接受。"""
    def fake_chat(messages):
        r = copy.deepcopy(RESUME)
        r["work"][0]["highlights"][0] = "服务 999999 名用户"  # 原文没有的数字
        return json.dumps(r, ensure_ascii=False)

    # 默认严格：拒绝 + 回退
    strict = improve(RESUME, EVAL, fake_chat)
    assert strict.accepted is False
    assert any(v.kind == "new_number" and v.severity == "error" for v in strict.violations)
    assert "999999" not in strict.resume["work"][0]["highlights"][0]  # 回退

    # 放宽：warn 接受
    loose = improve(RESUME, EVAL, fake_chat, strict_numbers=False)
    assert loose.accepted is True
    assert any(v.kind == "new_number" and v.severity == "warn" for v in loose.violations)
    print("OK: 凭空数字默认 error 回退、可降级为 warn")


def test_chat_failure_handled():
    """chat_fn 抛错 -> 结构化失败、回退原简历，不炸任务。"""
    def boom(messages):
        raise RuntimeError("provider down")

    res = improve(RESUME, EVAL, boom)
    assert res.accepted is False
    assert any(v.kind == "chat_fail" for v in res.violations)
    assert res.resume == RESUME
    print("OK: LLM 调用失败被结构化处理")


if __name__ == "__main__":
    test_scoring()
    test_total_score_clamped_and_robust()
    test_gap_report()
    test_legit_rewrite_accepted()
    test_fabricated_company_rejected()
    test_fabricated_number_rejected_by_default()
    test_chat_failure_handled()
    print("\nALL PASS")
