"""真机冒烟：用真实 Ollama 模型跑完整评估-改写-渲染闭环。

用法：
    python smoke_real.py            # 默认 gemma4:latest，2 轮
    python smoke_real.py --model gemma4:31b --rounds 1
"""

import argparse
import json
import time
from pathlib import Path

from resume_agent import run, format_report, build_real_deps
import kami_adapter


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="gemma4:latest")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--resume", default="sample_resume.json")
    ap.add_argument("-o", "--out", default=None)
    args = ap.parse_args()

    resume = json.loads(Path(args.resume).read_text("utf-8"))
    print(f"[smoke] 模型={args.model} 轮数={args.rounds}，构建真实依赖中...")
    evaluate_fn, chat_fn = build_real_deps(args.model)

    t0 = time.time()
    result = run(
        resume, evaluate_fn, chat_fn,
        target=85, max_rounds=args.rounds, lang="zh",
    )
    dt = time.time() - t0
    print(format_report(result))
    print(f"\n[smoke] 用时 {dt:.1f}s")

    out = Path(args.out) if args.out else Path("smoke_out.html")
    out.write_text(result.html, "utf-8")
    print(f"[smoke] 渲染输出 -> {out}")


if __name__ == "__main__":
    main()
