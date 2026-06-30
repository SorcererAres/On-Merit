"""resume_diff.py 离线测试。"""

from resume_diff import diff_resume, format_diff


def test_modified():
    old = {"basics": {"summary": "旧简介"}}
    new = {"basics": {"summary": "新简介"}}
    ch = diff_resume(old, new)
    assert len(ch) == 1 and ch[0].kind == "modified"
    assert ch[0].old == "旧简介" and ch[0].new == "新简介"
    print("OK: modified")


def test_highlights_positional():
    old = {"work": [{"highlights": ["a", "b"]}]}
    new = {"work": [{"highlights": ["a 改", "b", "c"]}]}
    ch = diff_resume(old, new)
    kinds = {(c.path, c.kind) for c in ch}
    assert ("work[0].highlights[0]", "modified") in kinds
    assert ("work[0].highlights[2]", "added") in kinds
    print("OK: highlights 逐位 diff")


def test_no_change():
    r = {"basics": {"summary": "同"}, "work": [{"summary": "x"}]}
    assert diff_resume(r, r) == []
    assert "无文本变更" in format_diff([])[0]
    print("OK: 无变更")


def test_format_added_flagged():
    # 真正的 added：字段原本不存在（MISSING）-> 有值
    old = {"projects": [{"name": "P"}]}
    new = {"projects": [{"name": "P", "description": "全新描述"}]}
    lines = format_diff(diff_resume(old, new))
    assert any("新增，请核对" in l for l in lines)
    print("OK: added 标注核对（MISSING -> 值）")


def test_empty_to_value_is_modified_not_added():
    """字段已存在但为空 / None -> 有值，算 modified 而非 added（Codex 复核）。"""
    old = {"basics": {"summary": ""}}
    new = {"basics": {"summary": "新内容"}}
    ch = diff_resume(old, new)
    assert len(ch) == 1 and ch[0].kind == "modified"
    # None -> 值 同样是 modified
    ch2 = diff_resume({"basics": {"summary": None}}, {"basics": {"summary": "x"}})
    assert ch2[0].kind == "modified"
    print("OK: 空/None -> 值 = modified")


def test_none_empty_swap_is_noise_free():
    """None <-> "" 互换不产生噪声变更。"""
    assert diff_resume({"basics": {"summary": None}}, {"basics": {"summary": ""}}) == []
    print("OK: None<->'' 不报噪声")


def test_format_diff_sanitizes_control_chars():
    """模型文本含换行/控制字符 -> 净化，不能伪造审计行。"""
    from resume_diff import Change
    forged = Change("modified", "x", "old", "new\n    [增] work[9].name（伪造）")
    out = "\n".join(format_diff([forged]))
    # 伪造的换行被折叠，不会单独成行
    assert "\n    [增] work[9]" not in out
    print("OK: 审计行防伪造")


def test_generic_covers_all_fields():
    """通用 diff 覆盖原先漏掉的字段：公司名 / 日期 / URL / 技术栈。"""
    old = {"work": [{"name": "A 公司", "startDate": "2020",
                     "url": "https://a.com", "position": "工程师"}],
           "projects": [{"name": "P", "technologies": ["Python"]}]}
    new = {"work": [{"name": "B 公司", "startDate": "2021",
                     "url": "https://b.com", "position": "工程师"}],
           "projects": [{"name": "P", "technologies": ["Python", "Rust"]}]}
    paths = {(c.path, c.kind) for c in diff_resume(old, new)}
    assert ("work[0].name", "modified") in paths
    assert ("work[0].startDate", "modified") in paths
    assert ("work[0].url", "modified") in paths
    assert ("work[0].position", "modified") not in paths  # 未变不报
    assert ("projects[0].technologies[1]", "added") in paths
    print("OK: 通用 diff 覆盖全字段")


if __name__ == "__main__":
    test_modified()
    test_highlights_positional()
    test_no_change()
    test_format_added_flagged()
    test_empty_to_value_is_modified_not_added()
    test_none_empty_swap_is_noise_free()
    test_format_diff_sanitizes_control_chars()
    test_generic_covers_all_fields()
    print("\nALL PASS")
