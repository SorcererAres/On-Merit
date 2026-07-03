"""SQLite 实现（stdlib sqlite3）。每操作开自己的连接；写操作走 BEGIN IMMEDIATE 单写事务。

字段：data(JSON)/export_md(排版MD)/source_text(原文层，W1)/layout_settings(JSON 样式，W1)。
snapshot 触发仅看内容（data 或 export_md 变），source_text/layout_settings 变不触发（防滑块刷屏），
但每条快照都完整包含这四者，回滚全量恢复文档。
"""

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
        data TEXT NOT NULL, export_md TEXT, source_text TEXT, layout_settings TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS revisions(
        id TEXT PRIMARY KEY,
        resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        data TEXT NOT NULL, export_md TEXT, source_text TEXT, layout_settings TEXT,
        title TEXT NOT NULL, role TEXT NOT NULL, jd TEXT NOT NULL,
        note TEXT NOT NULL, created_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS idx_resumes_updated ON resumes(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_rev_resume_created ON revisions(resume_id, created_at)",
    """CREATE TABLE IF NOT EXISTS diagnosis_reports(
        id TEXT PRIMARY KEY,
        resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
        role TEXT NOT NULL, role_label TEXT NOT NULL,
        score REAL NOT NULL, max_score REAL NOT NULL,
        has_jd INTEGER NOT NULL DEFAULT 0,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS idx_report_resume_created ON diagnosis_reports(resume_id, created_at)",
    "CREATE TABLE IF NOT EXISTS schema_version(v INTEGER NOT NULL)",
]

SCHEMA_VERSION = 2

# 老库补列（幂等）：新库 CREATE 已含这些列，_migrate 跳过；老库缺列则 ALTER 补上。
# （diagnosis_reports 是整表新增，CREATE IF NOT EXISTS 天然幂等，无需列迁移。）
_ADDED_COLS = {
    "resumes": [("source_text", "TEXT"), ("layout_settings", "TEXT")],
    "revisions": [("source_text", "TEXT"), ("layout_settings", "TEXT")],
}

MAX_REPORTS = 20  # 每简历诊断报告上限（超出裁剪最旧，同 MAX_REVISIONS 思路）


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return uuid.uuid4().hex


def _dump(v: Optional[Dict[str, Any]]) -> Optional[str]:
    return json.dumps(v, ensure_ascii=False) if v is not None else None


class SqliteRepo:
    def __init__(self, path: str):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, isolation_level=None, timeout=5.0)  # 自动提交，手动控事务
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
            # 迁移：幂等补列（老库无 source_text/layout_settings）
            for table, cols in _ADDED_COLS.items():
                existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
                for name, decl in cols:
                    if name not in existing:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
            row = conn.execute("SELECT v FROM schema_version").fetchone()
            if row is None:
                conn.execute("INSERT INTO schema_version(v) VALUES(?)", (SCHEMA_VERSION,))
            elif row[0] < SCHEMA_VERSION:
                conn.execute("UPDATE schema_version SET v=?", (SCHEMA_VERSION,))
        finally:
            conn.close()

    def _write(self, op: Callable[[sqlite3.Connection], Any]) -> Any:
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

    @staticmethod
    def _rec(row: sqlite3.Row) -> Dict[str, Any]:
        d = dict(row)
        d["data"] = json.loads(d["data"])
        d["layout_settings"] = json.loads(d["layout_settings"]) if d.get("layout_settings") else None
        return d

    def _get_row(self, conn: sqlite3.Connection, rid: str) -> sqlite3.Row:
        row = conn.execute("SELECT * FROM resumes WHERE id=?", (rid,)).fetchone()
        if row is None:
            raise NotFound(f"简历不存在：{rid}")
        return row

    def _snapshot(self, conn: sqlite3.Connection, cur: Dict[str, Any], note: str, now: str) -> None:
        """完整文档快照（含 source_text/layout_settings，TEXT 原样）。"""
        conn.execute(
            "INSERT INTO revisions(id,resume_id,data,export_md,source_text,layout_settings,"
            "title,role,jd,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (_uid(), cur["id"], cur["data"], cur["export_md"], cur["source_text"], cur["layout_settings"],
             cur["title"], cur["role"], cur["jd"], note, now))

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

    # --- 诊断报告记录 ---
    def add_report(self, rid: str, role: str, role_label: str, score: float,
                   max_score: float, has_jd: bool, report: Dict[str, Any]) -> Dict[str, Any]:
        """存一条诊断报告快照；超出 MAX_REPORTS 裁剪最旧。"""
        pid, now = _uid(), _now()

        def op(conn):
            self._get_row(conn, rid)  # 简历不存在 → NotFound
            conn.execute(
                "INSERT INTO diagnosis_reports(id,resume_id,role,role_label,score,max_score,"
                "has_jd,report,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (pid, rid, role, role_label, score, max_score, 1 if has_jd else 0,
                 json.dumps(report, ensure_ascii=False), now))
            conn.execute(
                "DELETE FROM diagnosis_reports WHERE resume_id=? AND id NOT IN ("
                " SELECT id FROM diagnosis_reports WHERE resume_id=?"
                " ORDER BY created_at DESC, rowid DESC LIMIT ?)",
                (rid, rid, MAX_REPORTS))
            return {"id": pid, "created_at": now}
        return self._write(op)

    def list_reports(self, rid: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            if conn.execute("SELECT 1 FROM resumes WHERE id=?", (rid,)).fetchone() is None:
                raise NotFound(f"简历不存在：{rid}")
            rows = conn.execute(
                "SELECT id,role,role_label,score,max_score,has_jd,created_at"
                " FROM diagnosis_reports WHERE resume_id=?"
                " ORDER BY created_at DESC, rowid DESC", (rid,)).fetchall()
            return [{**dict(r), "has_jd": bool(r["has_jd"])} for r in rows]
        finally:
            conn.close()

    def get_report(self, rid: str, report_id: str) -> Dict[str, Any]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM diagnosis_reports WHERE id=? AND resume_id=?",
                (report_id, rid)).fetchone()
            if row is None:
                raise NotFound(f"报告不存在或不属于该简历：{report_id}")
            d = dict(row)
            d["report"] = json.loads(d["report"])
            d["has_jd"] = bool(d["has_jd"])
            return d
        finally:
            conn.close()

    # --- 写 ---
    def create(self, title: str, role: str, jd: str = "",
               data: Optional[Dict[str, Any]] = None, export_md: Optional[str] = None,
               source_text: Optional[str] = None,
               layout_settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        rid, now = _uid(), _now()
        data_s = json.dumps(data if data is not None else {"basics": {}}, ensure_ascii=False)

        def op(conn):
            conn.execute(
                "INSERT INTO resumes(id,user_id,title,role,jd,data,export_md,source_text,layout_settings,"
                "version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)",
                (rid, None, title, role, jd, data_s, export_md, source_text, _dump(layout_settings), now, now))
            return self._rec(self._get_row(conn, rid))
        return self._write(op)

    def duplicate(self, rid: str) -> Dict[str, Any]:
        nid, now = _uid(), _now()

        def op(conn):
            src = dict(self._get_row(conn, rid))
            conn.execute(
                "INSERT INTO resumes(id,user_id,title,role,jd,data,export_md,source_text,layout_settings,"
                "version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?)",
                (nid, None, src["title"] + " 副本", src["role"], src["jd"], src["data"],
                 src["export_md"], src["source_text"], src["layout_settings"], now, now))
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
            new_src = patch["source_text"] if "source_text" in patch else cur["source_text"]
            new_layout = _dump(patch["layout_settings"]) if "layout_settings" in patch else cur["layout_settings"]
            data_changed = new_data != cur["data"]
            # export_md 安全网：data 变了就强制置空
            new_md = None if data_changed else (patch["export_md"] if "export_md" in patch else cur["export_md"])
            # 快照只在内容（data/export_md）变时触发；样式/原文变不刷快照，但快照仍完整含它们
            content_changed = data_changed or (new_md != cur["export_md"])
            if content_changed:
                self._snapshot(conn, cur, note, now)
            changed = conn.execute(
                "UPDATE resumes SET title=?,role=?,jd=?,data=?,export_md=?,source_text=?,layout_settings=?,"
                "version=version+1,updated_at=? WHERE id=? AND version=?",
                (new_title, new_role, new_jd, new_data, new_md, new_src, new_layout,
                 now, rid, expected_version)).rowcount
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
                "UPDATE resumes SET data=?,export_md=?,source_text=?,layout_settings=?,"
                "title=?,role=?,jd=?,version=version+1,updated_at=? WHERE id=? AND version=?",
                (rev["data"], rev["export_md"], rev["source_text"], rev["layout_settings"],
                 rev["title"], rev["role"], rev["jd"], now, rid, expected_version)).rowcount
            if changed == 0:
                raise Conflict(f"版本冲突：期望 {expected_version}，已被改动，请刷新")
            self._trim(conn, rid)
            return self._rec(self._get_row(conn, rid))
        return self._write(op)
