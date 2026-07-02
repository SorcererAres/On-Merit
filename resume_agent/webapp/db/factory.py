"""仓库工厂：按 env 选后端。DB_BACKEND=sqlite|postgres（默认 sqlite）。进程内单例。"""

from __future__ import annotations

import os
from pathlib import Path

_repo = None


def get_repo():
    global _repo
    if _repo is not None:
        return _repo
    backend = (os.getenv("DB_BACKEND") or "sqlite").strip().lower()
    if backend == "postgres":
        # P4 计划：Postgres 适配未实现。明确失败，绝不静默改写别的库。
        raise RuntimeError("DB_BACKEND=postgres 尚未实现（P4 计划）；当前请用 DB_BACKEND=sqlite")
    if backend != "sqlite":
        raise RuntimeError(f"未知 DB_BACKEND：{backend!r}，可选 sqlite（postgres 为 P4 计划）")
    # 默认 sqlite：路径相对 db 模块（= resume_agent/webapp/data/resumes.db），不依赖启动 cwd
    from .sqlite_repo import SqliteRepo
    default = Path(__file__).resolve().parent.parent / "data" / "resumes.db"
    _repo = SqliteRepo(os.getenv("RESUME_DB") or str(default))
    return _repo


def reset_repo_for_test():
    """测试用：清进程单例（切换临时库时调用）。"""
    global _repo
    _repo = None
