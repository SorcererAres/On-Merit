"""validate.py 离线测试 + 管线入口集成。"""

import json
from pathlib import Path

import validate
import kami_adapter
from resume_agent import run

RESUME = json.loads((Path(__file__).parent / "sample_resume.json").read_text("utf-8"))


def test_sample_is_valid():
    assert validate.validate_resume(RESUME) == []
    assert validate.is_valid(RESUME)
    print("OK: 样例简历合法")


def test_root_not_object():
    assert validate.validate_resume(["不是对象"])[0].startswith("根节点必须是")
    print("OK: 根节点非对象被拒")


def test_section_not_list():
    errs = validate.validate_resume({"work": "应该是列表"})
    assert any("work 必须是列表" in e for e in errs)
    print("OK: section 非列表被报")


def test_item_not_dict():
    errs = validate.validate_resume({"work": [{"name": "A"}, "坏元素", 123]})
    assert any("work[1] 必须是对象" in e for e in errs)
    assert any("work[2] 必须是对象" in e for e in errs)
    print("OK: 列表元素非对象被报")


def test_highlights_not_str_list():
    errs = validate.validate_resume({"work": [{"highlights": ["ok", 123]}]})
    assert any("work[0].highlights 必须是字符串列表" in e for e in errs)
    print("OK: highlights 非字符串列表被报")


def test_basics_shape():
    errs = validate.validate_resume({"basics": {"name": 123, "location": "x", "profiles": "y"}})
    assert any("basics.name" in e for e in errs)
    assert any("basics.location" in e for e in errs)
    assert any("basics.profiles" in e for e in errs)
    print("OK: basics 子结构校验")


def test_ensure_valid_raises():
    try:
        validate.ensure_valid({"work": "x"})
        assert False, "应抛异常"
    except ValueError as e:
        assert "结构不合法" in str(e)
    print("OK: ensure_valid 抛可读错误")


def test_pipeline_entry_rejects_malformed():
    """run() 入口对畸形简历 fail-fast。"""
    try:
        run({"work": "not a list"}, lambda r: {}, lambda m: "[]")
        assert False
    except ValueError:
        pass
    print("OK: run() 入口拒绝畸形输入")


def test_render_entry_rejects_malformed():
    try:
        kami_adapter.render_html({"work": ["bad"]})
        assert False
    except ValueError:
        pass
    print("OK: render_html 入口拒绝畸形输入")


if __name__ == "__main__":
    test_sample_is_valid()
    test_root_not_object()
    test_section_not_list()
    test_item_not_dict()
    test_highlights_not_str_list()
    test_basics_shape()
    test_ensure_valid_raises()
    test_pipeline_entry_rejects_malformed()
    test_render_entry_rejects_malformed()
    print("\nALL PASS")
