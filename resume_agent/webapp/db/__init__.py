"""简历持久化仓库包（见 docs/plans/multi-resume-persistence.md）。"""

from .repo import Conflict, MAX_REVISIONS, NotFound, RepoError, ResumeRepo
from .factory import get_repo, reset_repo_for_test
from .sqlite_repo import SqliteRepo

__all__ = [
    "get_repo", "reset_repo_for_test", "SqliteRepo",
    "ResumeRepo", "RepoError", "NotFound", "Conflict", "MAX_REVISIONS",
]
