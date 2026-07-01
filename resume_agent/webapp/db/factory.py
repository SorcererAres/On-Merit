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
        from .pg_repo import PgRepo  # P4：需 psycopg + DATABASE_URL
        _repo = PgRepo(os.environ.get("DATABASE_URL", ""))
    else:
        # 默认 sqlite：路径相对 db 模块（= resume_agent/webapp/data/resumes.db），不依赖启动 cwd
        default = Path(__file__).resolve().parent.parent / "data" / "resumes.db"
        _repo = SqliteRepoLazy(os.getenv("RESUME_DB") or str(default))
    return _repo


def SqliteRepoLazy(path):
    from .sqlite_repo import SqliteRepo
    return SqliteRepo(path)


def reset_repo_for_test():
    """测试用：清进程单例（切换临时库时调用）。"""
    global _repo
    _repo = None
