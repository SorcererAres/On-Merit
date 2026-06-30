"""resume_agent.py 离线闭环测试：假评估器 + 假改写，无需 LLM。"""

import copy
import json
from pathlib import Path

from resume_agent import run, format_report, _converged

RESUME = json.loads((Path(__file__).parent / "sample_resume.json").read_text("utf-8"))


def _eval_with_score(prod_score):
    """构造一个 production 分可控的评估结果。其余固定。"""
    return {
        "scores": {
            "open_source": {"score": 8, "max": 35, "evidence": "个人项目为主"},
            "self_projects": {"score": 22, "max": 30, "evidence": "有链接"},
            "production": {"score": prod_score, "max": 25, "evidence": "量化程度"},
            "technical_skills": {"score": 9, "max": 10, "evidence": "广度好"},
        },
        "bonus_points": {"total": 2, "breakdown": "portfolio"},
        "deductions": {"total": 0, "reasons": ""},
        "key_strengths": ["从 0 到 1"],
        "areas_for_improvement": ["职责量化"],
    }


def test_loop_improves_then_renders():
    """改写后 production 分提升，编排器应保留最高分并能渲染。"""
    state = {"prod": 10, "n": 0}

    def evaluate_fn(resume):
        # 每被改写一次，production 分 +6（模拟改写见效）
        return _eval_with_score(state["prod"])

    def chat_fn(messages):
        r = copy.deepcopy(RESUME)
        r["work"][0]["summary"] = "主导平台核心链路。"  # 合法改写
        state["prod"] += 6  # 下一轮评估会更高
        return json.dumps(r, ensure_ascii=False)

    res = run(RESUME, evaluate_fn, chat_fn, target=85, max_rounds=3, converge_delta=2)

    s = [r.score for r in res.history]
    assert s == sorted(s), f"分数应单调不降：{s}"
    assert res.best_score == max(s)
    assert res.html and "section-title" in res.html
    print(f"OK: 闭环提分 {s}，渲染成功")


def test_rejected_rewrite_does_not_lose_score():
    """改写虚构被拒时，最高分版本不丢。"""
    def evaluate_fn(resume):
        return _eval_with_score(15)

    def chat_fn(messages):
        r = copy.deepcopy(RESUME)
        r["work"].append({"name": "虚构公司", "position": "x"})  # 会被拦截
        return json.dumps(r, ensure_ascii=False)

    res = run(RESUME, evaluate_fn, chat_fn, target=99, max_rounds=3, converge_delta=0.1)
    # 第一轮记录的改写应标记为未接受
    assert any(not r.accepted for r in res.history)
    # 最终简历仍只有 1 段工作（没被污染）
    assert len(res.resume["work"]) == 1
    print("OK: 虚构改写被拒，分数与简历不受损")


def test_converge_helper():
    assert _converged([50, 51], delta=2) is True      # 提升 1 < 2
    assert _converged([50, 55], delta=2) is False     # 提升 5 >= 2
    print("OK: 收敛判定")


def test_patch_mode_loop():
    """mode=patch：闭环用 patch-only 改写，越权补丁无效、合法补丁提分。"""
    state = {"prod": 12}

    def evaluate_fn(resume):
        return _eval_with_score(state["prod"])

    def chat_fn(messages):
        state["prod"] += 5
        return json.dumps([
            {"path": "work[0].name", "text": "谷歌"},               # 越权 -> 无效
            {"path": "work[0].summary", "text": "主导平台核心链路。"},  # 合法
        ], ensure_ascii=False)

    res = run(RESUME, evaluate_fn, chat_fn, target=99, max_rounds=2,
              converge_delta=0.1, mode="patch")
    assert res.resume["work"][0]["name"] == "某科技公司"  # 公司名从未被改
    assert [r.score for r in res.history] == sorted(r.score for r in res.history)
    print("OK: patch 模式闭环（结构不可篡改）")


def test_report_renders():
    res = run(RESUME, lambda r: _eval_with_score(20), lambda m: json.dumps(RESUME),
              target=99, max_rounds=1)
    txt = format_report(res)
    assert "分数轨迹" in txt and "最高分" in txt
    print("OK: 报告生成")


if __name__ == "__main__":
    test_converge_helper()
    test_loop_improves_then_renders()
    test_rejected_rewrite_does_not_lose_score()
    test_patch_mode_loop()
    test_report_renders()
    print("\nALL PASS")
