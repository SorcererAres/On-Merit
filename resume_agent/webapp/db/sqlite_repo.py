"""SQLite 实现（stdlib sqlite3）。每操作开自己的连接；写操作走 BEGIN IMMEDIATE 单写事务。"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .repo import Conflict, NotFound, MAX_REVISIONS

_SCHEMA = [
    """CREATE TABLE IF NOT EXISTS resumes(
        id TEXT PRIMARY KEY, user_id TEXT,
        title TEXT NOT NULL, role TEXT NOT NULL, jd TEXT NOT NULL DEFAULT '',
        data TEXT NOT NULL, export_md TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS revisions(
        id TEXT PRIMARY KEY,
        resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        data TEXT NOT NULL, export_md TEXT,
        title TEXT NOT NULL, role TEXT NOT NULL, jd TEXT NOT NULL,
        note TEXT NOT NULL, created_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS idx_resumes_updated ON resumes(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_rev_resume_created ON revisions(resume_id, created_at)",
    "CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)",
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return uuid.uuid4().hex


class SqliteRepo:
    def __init__(self, path: str):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    # --- 连接：每操作一个，PRAGMA 逐连接设置 ---
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=5.0)  # 自动提交模式，手动控事务
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _init_schema(self) -> None:
        conn = self._connect()
        try:
            for stmt in _SCHEMA:
                conn.execute(stmt)
            if conn.execute("SELECT v FROM schema_version").fetchone() is None:
                conn.execute("INSERT INTO schema_version(v) VALUES(1)")
        finally:
            conn.close()

    def _write(self, op: Callable[[sqlite3.Connection], Any]) -> Any:
        """单写事务：BEGIN IMMEDIATE 取写锁；op 内任何异常 → ROLLBACK（快照等一并撤销）。"""
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            try:
                result = op(conn)
                conn.execute("COMMIT")
                return result
            except Exception:
                conn.execute("ROLLBACK")
                raise
        finally:
            conn.close()

    # --- 行 -> record ---
    @staticmethod
    def _rec(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        d["data"] = json.loads(d["data"])
        return d

    def _get_row(self, conn: sqlite3.Connection, rid: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM resumes WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise NotFound(f"简历不存在：{rid}")
        return row

    def _snapshot(self, conn: sqlite3.Connection, cur: Dict[str, Any], note: str, now: str) -> None:
        """把当前行（TEXT 原样）写入一条完整快照。"""
        conn.execute(
            "INSERT INTO revisions(id,resume_id,data,export_md,title,role,jd,note,created_at)"
            " VALUES(?,?,?,?,?,?,?,?,?)",
            (_uid(), cur["id"], cur["data"], cur["export_md"], cur["title"],
             cur["role"], cur["jd"], note, now))

    def _trim(self, conn: sqlite3.Connection, rid: str) -> None:
        conn.execute(
            "DELETE FROM revisions WHERE resume_id=? AND id NOT IN ("
            " SELECT id FROM revisions WHERE resume_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)",
            (rid, rid, MAX_REVISIONS))

    # --- 读 ---
    def list(self) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT id,title,role,version,updated_at FROM resumes ORDER BY updated_at DESC").fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get(self, rid: str) -> Dict[str, Any]:
        conn = self._connect()
        try:
            return self._rec(self._get_row(conn, rid))
        finally:
            conn.close()

    def list_revisions(self, rid: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            if conn.execute("SELECT 1 FROM resumes WHERE id=?", (rid,)).fetchone() is None:
                raise NotFound(f"简历不存在：{rid}")
            rows = conn.execute(
                "SELECT id,note,created_at FROM revisions WHERE resume_id=? ORDER BY created_at DESC, rowid DESC",
                (rid,)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    # --- 写 ---
    def create(self, title: str, role: str, jd: str = "",
               data: Optional[Dict[str, Any]] = None, export_md: Optional[str] = None) -> Dict[str, Any]:
        rid, now = _uid(), _now()
        data_s = json.dumps(data if data is not None else {"basics": {}}, ensure_ascii=False)

        def op(conn):
            conn.execute(
                "INSERT INTO resumes(id,user_id,title,role,jd,data,export_md,version,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,1,?,?)",
                (rid, None, title, role, jd, data_s, export_md, now, now))
            return self._rec(self._get_row(conn, rid))
        return self._write(op)

    def duplicate(self, rid: str) -> Dict[str, Any]:
        nid, now = _uid(), _now()

        def op(conn):
            src = dict(self._get_row(conn, rid))
            conn.execute(
                "INSERT INTO resumes(id,user_id,title,role,jd,data,export_md,version,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,1,?,?)",
                (nid, None, src["title"] + " 副本", src["role"], src["jd"],
                 src["data"], src["export_md"], now, now))
            return self._rec(self._get_row(conn, nid))
        return self._write(op)

    def delete(self, rid: str) -> None:
        def op(conn):
            if conn.execute("DELETE FROM resumes WHERE id=?", (rid,)).rowcount == 0:
                raise NotFound(f"简历不存在：{rid}")
        self._write(op)

    def update(self, rid: str, patch: Dict[str, Any], expected_version: int,
               note: str = "修改前") -> Dict[str, Any]:
        now = _now()

        def op(conn):
            cur = dict(self._get_row(conn, rid))
            new_title = patch.get("title", cur["title"])
            new_role = patch.get("role", cur["role"])
            new_jd = patch.get("jd", cur["jd"])
            new_data = json.dumps(patch["data"], ensure_ascii=False) if "data" in patch else cur["data"]
            data_changed = new_data != cur["data"]
            # export_md 安全网：data 变了就强制置空，无视 patch 里可能残留的旧 md
            if data_changed:
                new_md = None
            else:
                new_md = patch["export_md"] if "export_md" in patch else cur["export_md"]
            content_changed = data_changed or (new_md != cur["export_md"])
            if content_changed:  # 覆盖前先快照旧版
                self._snapshot(conn, cur, note, now)
            # 版本谓词落在覆盖 UPDATE 上（乐观并发，rowcount=0 → Conflict）
            changed = conn.execute(
                "UPDATE resumes SET title=?,role=?,jd=?,data=?,export_md=?,version=version+1,updated_at=?"
                " WHERE id=? AND version=?",
                (new_title, new_role, new_jd, new_data, new_md, now, rid, expected_version)).rowcount
            if changed == 0:
                raise Conflict(f"版本冲突：期望 {expected_version}，已被改动，请刷新")
            if content_changed:
                self._trim(conn, rid)
            return self._rec(self._get_row(conn, rid))
        return self._write(op)

    def rollback(self, rid: str, revision_id: str, expected_version: int,
                 note: str = "回滚前") -> Dict[str, Any]:
        now = _now()

        def op(conn):
            cur = dict(self._get_row(conn, rid))
            rev = conn.execute(
                "SELECT * FROM revisions WHERE id=? AND resume_id=?", (revision_id, rid)).fetchone()
            if rev is None:
                raise NotFound(f"版本不存在或不属于该简历：{revision_id}")
            rev = dict(rev)
            self._snapshot(conn, cur, note, now)  # 回滚前快照当前
            changed = conn.execute(
                "UPDATE resumes SET data=?,export_md=?,title=?,role=?,jd=?,version=version+1,updated_at=?"
                " WHERE id=? AND version=?",
                (rev["data"], rev["export_md"], rev["title"], rev["role"], rev["jd"],
                 now, rid, expected_version)).rowcount
            if changed == 0:
                raise Conflict(f"版本冲突：期望 {expected_version}，已被改动，请刷新")
            self._trim(conn, rid)
            return self._rec(self._get_row(conn, rid))
        return self._write(op)
