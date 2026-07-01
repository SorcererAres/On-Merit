"""简历仓库抽象（多简历持久化）。

见 docs/plans/multi-resume-persistence.md（已过跨模型复核）的事务/并发契约：
- update / rollback 单写事务内完成，版本谓词落在覆盖 UPDATE 上并查 rowcount（乐观并发，防 TOCTOU）；
- 快照写在覆盖之前，UPDATE 失败则整事务回滚、连同快照一并撤销；
- data 变更时 export_md 强制置 NULL（安全网）；每简历 revisions 限 MAX_REVISIONS。

P1 只实现 SQLite（默认、可测）；Postgres 适配为 P4，同一协议。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol

MAX_REVISIONS = 20  # 每简历保留的历史版本上限（超出删最旧）


class RepoError(Exception):
    """仓库层错误基类。"""


class NotFound(RepoError):
    """资源不存在（API 转 404）。"""


class Conflict(RepoError):
    """乐观并发版本冲突（API 转 409）。"""


class ResumeRepo(Protocol):
    """简历仓库协议。record 为 dict：id/user_id/title/role/jd/data(解析后 dict)/export_md/version/created_at/updated_at。"""

    def list(self) -> List[Dict[str, Any]]: ...            # 仅元数据（不含 data）
    def get(self, rid: str) -> Dict[str, Any]: ...          # 完整；NotFound
    def create(self, title: str, role: str, jd: str = "",
               data: Optional[Dict[str, Any]] = None, export_md: Optional[str] = None) -> Dict[str, Any]: ...
    def update(self, rid: str, patch: Dict[str, Any], expected_version: int,
               note: str = "修改前") -> Dict[str, Any]: ...  # NotFound / Conflict
    def delete(self, rid: str) -> None: ...                 # NotFound
    def duplicate(self, rid: str) -> Dict[str, Any]: ...    # NotFound
    def list_revisions(self, rid: str) -> List[Dict[str, Any]]: ...  # 元数据；NotFound
    def rollback(self, rid: str, revision_id: str, expected_version: int,
                 note: str = "回滚前") -> Dict[str, Any]: ...  # NotFound / Conflict
