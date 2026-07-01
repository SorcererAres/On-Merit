"""仓库层离线单测（SQLite 临时库）。覆盖 multi-resume-persistence.md §五 的契约点。

运行：cd resume_agent/webapp && python test_db.py
"""

import tempfile
from pathlib import Path

from db import SqliteRepo, NotFound, Conflict, MAX_REVISIONS


def _repo():
    d = tempfile.mkdtemp()
    return SqliteRepo(str(Path(d) / "t.db"))


def test_crud_roundtrip():
    r = _repo()
    rec = r.create("张三的简历", "designer", jd="JD", data={"basics": {"name": "张三"}})
    assert rec["version"] == 1 and rec["data"]["basics"]["name"] == "张三"
    got = r.get(rec["id"])
    assert got["title"] == "张三的简历" and got["data"] == {"basics": {"name": "张三"}}
    # list 只返元数据（无 data）
    lst = r.list()
    assert len(lst) == 1 and "data" not in lst[0] and lst[0]["id"] == rec["id"]
    print("OK: CRUD 往返 + list 只元数据")


def test_get_missing_404():
    r = _repo()
    try:
        r.get("nope"); assert False
    except NotFound:
        pass
    print("OK: get 缺失 → NotFound")


def test_update_snapshots_and_version():
    r = _repo()
    rec = r.create("t", "engineer", data={"basics": {}})
    # data 变化 → 快照旧版 + version+1
    up = r.update(rec["id"], {"data": {"basics": {"name": "A"}}}, expected_version=1)
    assert up["version"] == 2 and up["data"]["basics"]["name"] == "A"
    assert len(r.list_revisions(rec["id"])) == 1
    # 仅改 title（元数据）→ version+1 但不快照
    up2 = r.update(rec["id"], {"title": "新名"}, expected_version=2)
    assert up2["version"] == 3 and up2["title"] == "新名"
    assert len(r.list_revisions(rec["id"])) == 1  # 未新增快照
    print("OK: update data 快照+版本；元数据改不快照")


def test_export_md_safety_net():
    r = _repo()
    rec = r.create("t", "engineer", data={"basics": {}}, export_md="# 旧排版")
    # data 变了：即便 patch 想保留旧 export_md，也被强制置 NULL
    up = r.update(rec["id"], {"data": {"basics": {"name": "X"}}, "export_md": "# 旧排版"}, expected_version=1)
    assert up["export_md"] is None
    # data 不变、只改 export_md：允许
    up2 = r.update(rec["id"], {"export_md": "# 新排版"}, expected_version=2)
    assert up2["export_md"] == "# 新排版"
    print("OK: export_md 安全网（data 变→置空；纯排版可改）")


def test_optimistic_conflict_and_atomicity():
    r = _repo()
    rec = r.create("t", "engineer", data={"basics": {}})
    # 过期 version → Conflict
    try:
        r.update(rec["id"], {"data": {"basics": {"name": "Z"}}}, expected_version=999); assert False
    except Conflict:
        pass
    # 原子性：冲突时不留半个快照
    assert len(r.list_revisions(rec["id"])) == 0
    print("OK: 乐观并发 Conflict + 冲突不留孤儿快照（原子）")


def test_revisions_trim():
    r = _repo()
    rec = r.create("t", "engineer", data={"basics": {"n": 0}})
    v = 1
    for i in range(1, MAX_REVISIONS + 5):  # 制造超过上限的 data 变更
        r.update(rec["id"], {"data": {"basics": {"n": i}}}, expected_version=v)
        v += 1
    assert len(r.list_revisions(rec["id"])) == MAX_REVISIONS
    print(f"OK: revisions 裁剪到 {MAX_REVISIONS}")


def test_duplicate():
    r = _repo()
    rec = r.create("原件", "designer", jd="J", data={"basics": {"name": "A"}})
    r.update(rec["id"], {"data": {"basics": {"name": "B"}}}, expected_version=1)  # 制造一条 revision
    dup = r.duplicate(rec["id"])
    assert dup["id"] != rec["id"] and dup["title"] == "原件 副本" and dup["version"] == 1
    assert dup["data"]["basics"]["name"] == "B"  # 复制当前内容
    assert len(r.list_revisions(dup["id"])) == 0  # 不复制历史
    print("OK: duplicate（新 id/副本名/version=1/不带历史）")


def test_delete_cascade():
    r = _repo()
    rec = r.create("t", "engineer", data={"basics": {}})
    r.update(rec["id"], {"data": {"basics": {"n": 1}}}, expected_version=1)
    assert len(r.list_revisions(rec["id"])) == 1
    r.delete(rec["id"])
    try:
        r.get(rec["id"]); assert False
    except NotFound:
        pass
    # revisions 级联删除 → 该 id 的历史查询也 NotFound（简历没了）
    try:
        r.list_revisions(rec["id"]); assert False
    except NotFound:
        pass
    # 删缺失 → NotFound
    try:
        r.delete("nope"); assert False
    except NotFound:
        pass
    print("OK: delete 级联删 revisions + 删缺失 NotFound")


def test_rollback():
    r = _repo()
    rec = r.create("t", "engineer", jd="J1", data={"basics": {"name": "V1"}}, export_md="# md1")
    # 改到 V2（快照 V1）
    up = r.update(rec["id"], {"data": {"basics": {"name": "V2"}}, "title": "T2", "jd": "J2"}, expected_version=1)
    revs = r.list_revisions(rec["id"])
    assert len(revs) == 1
    rev_v1 = revs[0]["id"]
    # 回滚到 V1：全量恢复 data/export_md/title/role/jd
    back = r.rollback(rec["id"], rev_v1, expected_version=up["version"])
    assert back["data"]["basics"]["name"] == "V1" and back["export_md"] == "# md1"
    assert back["jd"] == "J1" and back["version"] == up["version"] + 1
    # 回滚也快照了「回滚前」当前版
    assert len(r.list_revisions(rec["id"])) == 2
    print("OK: rollback 全量恢复 + 回滚前快照 + version+1")


def test_rollback_cross_resume_and_conflict():
    r = _repo()
    a = r.create("a", "engineer", data={"basics": {"n": "a"}})
    b = r.create("b", "engineer", data={"basics": {"n": "b"}})
    r.update(b["id"], {"data": {"basics": {"n": "b2"}}}, expected_version=1)
    b_rev = r.list_revisions(b["id"])[0]["id"]
    # 用 b 的 revision 回滚 a → NotFound（不属于该简历）
    try:
        r.rollback(a["id"], b_rev, expected_version=1); assert False
    except NotFound:
        pass
    # 过期 version 回滚 → Conflict
    r.update(a["id"], {"data": {"basics": {"n": "a2"}}}, expected_version=1)
    a_rev = r.list_revisions(a["id"])[0]["id"]
    try:
        r.rollback(a["id"], a_rev, expected_version=999); assert False
    except Conflict:
        pass
    print("OK: rollback 跨简历 NotFound + 过期 version Conflict")


if __name__ == "__main__":
    test_crud_roundtrip()
    test_get_missing_404()
    test_update_snapshots_and_version()
    test_export_md_safety_net()
    test_optimistic_conflict_and_atomicity()
    test_revisions_trim()
    test_duplicate()
    test_delete_cascade()
    test_rollback()
    test_rollback_cross_resume_and_conflict()
    print("\nALL PASS")
