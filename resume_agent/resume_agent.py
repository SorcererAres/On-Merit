"""P2：闭环编排器。

把四阶段串起来：
    ② EVALUATE -> （达标或收敛？停）-> ③ IMPROVE -> 回到 ② ... -> ④ RENDER + 报告

评估（``evaluate_fn``）和改写（``chat_fn``）都是可注入依赖：
  - 真实运行：``build_real_deps()`` 接 hiring-agent 的评估器和 LLM provider；
  - 离线测试：注入假函数即可跑通整条闭环（见 test_resume_agent.py）。

注意：① INGEST（PDF -> JSON Resume）直接用 hiring-agent 的 score.py / pdf.py，
本编排器从「已有 resume.json」起步，聚焦评估-改写-渲染闭环。
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from improver import ImproveResult, improve, total_score, fact_gap_report
from patcher import improve_via_patch
from resume_diff import Change, diff_resume, format_diff
from validate import ensure_valid
import kami_adapter

EvaluateFn = Callable[[Dict[str, Any]], Dict[str, Any]]  # resume -> evaluation(dict)
ChatFn = Callable[[List[Dict[str, str]]], str]


@dataclass
class RoundRecord:
    index: int
    score: float
    accepted: bool
    violations: List[str] = field(default_factory=list)
    gaps: List[str] = field(default_factory=list)
    changes: List[Change] = field(default_factory=list)  # 本轮改写的逐字段 diff


@dataclass
class AgentResult:
    resume: Dict[str, Any]            # 最终（最高分）简历
    best_score: float
    history: List[RoundRecord]
    final_evaluation: Dict[str, Any]
    gaps: List[str] = field(default_factory=list)  # 对应 best_resume 的事实缺口
    html: Optional[str] = None


def _converged(scores: List[float], delta: float) -> bool:
    """连续两轮提升 < delta 视为收敛。"""
    return len(scores) >= 2 and (scores[-1] - scores[-2]) < delta


def run(
    resume: Dict[str, Any],
    evaluate_fn: EvaluateFn,
    chat_fn: ChatFn,
    *,
    target: float = 85.0,
    max_rounds: int = 3,
    converge_delta: float = 2.0,
    lang: str = "zh",
    render: bool = True,
    strict_highlights: bool = False,
    strict_numbers: bool = True,
    mode: str = "rewrite",
) -> AgentResult:
    """跑评估-改写闭环，返回最高分版本 + 轨迹。

    关键点：始终保留「历史最高分」版本，改写被拒或反而变差时不丢分。
    入口先做结构校验，畸形简历立刻报错而非在深处崩溃。
    """
    ensure_valid(resume)
    current = copy.deepcopy(resume)
    best_resume = copy.deepcopy(resume)
    best_score = float("-inf")
    best_eval: Dict[str, Any] = {}
    best_gaps: List[str] = []
    history: List[RoundRecord] = []
    scores: List[float] = []

    for i in range(max_rounds):
        evaluation = evaluate_fn(current)
        score = total_score(evaluation)
        scores.append(score)
        gaps = fact_gap_report(current, evaluation)

        if score > best_score:
            best_score, best_resume, best_eval = score, copy.deepcopy(current), evaluation
            best_gaps = gaps  # 与 best_resume 同步，避免报告取到末轮的不一致缺口

        history.append(RoundRecord(i, score, accepted=True, gaps=gaps))

        # 达标 / 收敛 / 最后一轮 -> 不再改写
        if score >= target or _converged(scores, converge_delta) or i == max_rounds - 1:
            break

        if mode == "patch":
            result: ImproveResult = improve_via_patch(
                current, evaluation, chat_fn, strict_numbers=strict_numbers
            )
        else:
            result = improve(
                current, evaluation, chat_fn,
                strict_highlights=strict_highlights, strict_numbers=strict_numbers,
            )
        history[-1].accepted = result.accepted
        history[-1].violations = [f"[{v.severity}] {v.kind}: {v.detail}" for v in result.violations]
        if result.accepted:
            history[-1].changes = diff_resume(current, result.resume)
            current = result.resume
        # 被拒则保持 current 不变，下一轮重评（通常 break，因为没变化会触发收敛）

    out = AgentResult(
        resume=best_resume,
        best_score=best_score,
        history=history,
        final_evaluation=best_eval,
        gaps=best_gaps,
    )
    if render:
        out.html = kami_adapter.render_html(best_resume, lang=lang)
    return out


def format_report(result: AgentResult) -> str:
    lines = ["=" * 56, "Resume Agent 闭环报告", "=" * 56]
    lines.append("分数轨迹：")
    for r in result.history:
        flag = "" if r.accepted else "  <- 改写被拒/回退"
        lines.append(f"  第 {r.index + 1} 轮：{r.score} / 120{flag}")
        for v in r.violations:
            lines.append(f"      {v}")
        if r.changes:
            lines.append("    本轮改动：")
            lines.extend(format_diff(r.changes, indent="      "))
    lines.append(f"\n最高分：{result.best_score} / 120")

    gaps = result.gaps
    if gaps:
        lines.append("\n需真实补充（改写无法提分，事实层缺口）：")
        for g in gaps:
            lines.append(f"  - {g}")

    fe = result.final_evaluation
    if fe.get("key_strengths"):
        lines.append("\n核心优势：")
        for s in fe["key_strengths"]:
            lines.append(f"  - {s}")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# 真实依赖工厂（接 hiring-agent）
# --------------------------------------------------------------------------- #
def build_real_deps(model_name: Optional[str] = None):
    """返回 (evaluate_fn, chat_fn)，接 hiring-agent 评估器 + LLM provider。

    需要 hiring-agent 配好 Ollama 或 Gemini。
    """
    import sys

    ha = Path(__file__).resolve().parent.parent / "hiring-agent"
    if str(ha) not in sys.path:
        sys.path.insert(0, str(ha))

    from models import JSONResume
    from evaluator import ResumeEvaluator
    from transform import convert_json_resume_to_text
    from prompts.template_manager import TemplateManager
    from improver import make_hiring_agent_chat_fn

    evaluator = ResumeEvaluator(model_name=model_name) if model_name else ResumeEvaluator()
    # TemplateManager 默认按 CWD 相对路径找模板；改用 hiring-agent 下的绝对路径，
    # 这样从任意目录运行都能定位 prompts/templates。
    evaluator.template_manager = TemplateManager(
        template_dir=str(ha / "prompts" / "templates")
    )

    def evaluate_fn(resume: Dict[str, Any]) -> Dict[str, Any]:
        text = convert_json_resume_to_text(JSONResume(**resume))
        return evaluator.evaluate_resume(text).model_dump()

    return evaluate_fn, make_hiring_agent_chat_fn(model_name)


def main() -> None:
    ap = argparse.ArgumentParser(description="Resume Agent 评估-改写-渲染闭环")
    ap.add_argument("resume_json", help="起始 JSON Resume 路径")
    ap.add_argument("-o", "--out", help="渲染输出（.html/.pdf）")
    ap.add_argument("--lang", default="zh", choices=["zh", "en", "ko"])
    ap.add_argument("--target", type=float, default=85.0)
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--model", default=None, help="覆盖 LLM 模型名")
    ap.add_argument(
        "--strict-highlights", action="store_true",
        help="把净新增成果要点也判为造假并回退（默认仅 diff 标注）",
    )
    ap.add_argument(
        "--allow-new-numbers", action="store_true",
        help="放宽：原文没有的数字仅 warn 标注而非回退（默认 error 回退）",
    )
    ap.add_argument(
        "--no-brand", action="store_true",
        help="忽略 ~/.config/kami/brand.md（默认作兜底填充缺失字段）",
    )
    ap.add_argument(
        "--mode", default="rewrite", choices=["rewrite", "patch"],
        help="改写模式：rewrite=整份重写+校验；patch=只返回受限补丁（结构造假物理不可能，更严）",
    )
    args = ap.parse_args()

    resume = json.loads(Path(args.resume_json).read_text("utf-8"))

    # brand.md 兜底：仅填简历未给出的字段，并在 --lang 未显式指定时派生语言
    lang = args.lang
    if not args.no_brand:
        from brand import load_brand, apply_brand, brand_defaults

        brand = load_brand()
        if brand:
            apply_brand(resume, brand)
            b_role, b_lang = brand_defaults(brand)
            if "--lang" not in sys.argv:
                lang = b_lang
            print(f"OK: 已应用 brand.md（兜底字段，语言={lang}）")

    evaluate_fn, chat_fn = build_real_deps(args.model)
    result = run(
        resume, evaluate_fn, chat_fn,
        target=args.target, max_rounds=args.max_rounds, lang=lang,
        strict_highlights=args.strict_highlights,
        strict_numbers=not args.allow_new_numbers,
        mode=args.mode,
    )
    print(format_report(result))

    if args.out:
        out = Path(args.out)
        if out.suffix.lower() == ".pdf":
            if not kami_adapter.render_pdf(result.html, out, lang=lang):
                out = out.with_suffix(".html")
                out.write_text(result.html, "utf-8")
                print(f"\nERROR: 未装 weasyprint，降级输出 HTML -> {out}")
            else:
                print(f"\nOK: 已渲染 PDF -> {out}")
        else:
            out.write_text(result.html, "utf-8")
            print(f"\nOK: 已渲染 HTML -> {out}")


if __name__ == "__main__":
    main()
