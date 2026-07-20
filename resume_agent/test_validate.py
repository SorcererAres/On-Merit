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


def test_validator_no_crash_on_nonlist_section():
    """Codex 复核：validator 自身不能被非 list section 击穿（曾 TypeError）。"""
    errs = validate.validate_resume({"work": 1})  # 不抛异常
    assert any("work 必须是列表" in e for e in errs)
    print("OK: validator 不被非 list 击穿")


def test_string_field_checks():
    """Codex 复核：补 projects[].url / profiles[].network 字符串校验（下游会崩）。"""
    assert any("projects[0].url" in e for e in validate.validate_resume({"projects": [{"url": 123}]}))
    errs = validate.validate_resume({"basics": {"profiles": [{"network": 1, "url": 2}]}})
    assert any("network" in e for e in errs) and any("url" in e for e in errs)
    print("OK: url / network 字符串校验")


def test_length_str_too_long():
    """借鉴 self.so：单字段塞巨量文本被拦（防注入/撑爆上下文）。"""
    errs = validate.validate_resume({"basics": {"summary": "x" * (validate.MAX_STR_LEN + 1)}})
    assert any("文本过长" in e for e in errs)
    print("OK: 超长字符串被拦")


def test_length_array_too_long():
    """海量条目被拦。"""
    errs = validate.validate_resume({"work": [{"name": "A"} for _ in range(validate.MAX_ARRAY_LEN + 1)]})
    assert any("列表过长" in e for e in errs)
    print("OK: 超长数组被拦")


def test_length_normal_ok():
    """正常体量简历不误伤。"""
    assert validate.validate_resume(RESUME) == []
    print("OK: 正常简历不被体量闸误伤")


def test_new_fields_valid_full_roundtrip():
    """编辑表单 v3 全新字段合法记录：不报错。"""
    r = {
        "basics": {"name": "张三", "gender": "male", "birthMonth": "1995-08",
                   "wechat": "zs_wx", "hometown": "北京", "tags": ["设计", "AI"]},
        "education": [{"institution": "某大学", "studyMode": "full_time", "description": "**主修**课程"}],
        "work": [{"name": "A 公司", "description": "- 做了 X\n- 做了 Y"}],
        "projects": [{"name": "P", "role": "负责人", "startDate": "2023-01", "endDate": "至今",
                      "description": "STAR"}],
        "skills_md": "- **技能**：Python",
        "job_intent": {"positions": ["产品经理"], "city": "上海"},
        "internships": [{"name": "实习公司", "description": "实习内容"}],
        "organizations": [{"name": "社团", "role": "部长", "description": "社团经历"}],
        "campus": [{"name": "品牌大使", "description": "x"}],
        "thesis": [{"title": "毕设", "description": "x"}],
        "competitions": [{"name": "竞赛", "award": "一等奖", "description": "x"}],
        "custom_sections": [{"id": "c1", "title": "个人作品", "content": "内容"},
                            {"id": "c2", "title": "其他", "content": "内容"}],
        "modules_order": ["summary", "exp", "proj", "skills", "edu", "certs", "custom:0", "custom:c2"],
    }
    assert validate.validate_resume(r) == [], validate.validate_resume(r)
    print("OK: v3 新字段全字段合法记录通过")


def test_new_fields_reject_each_rule():
    def has(data, frag):
        errs = validate.validate_resume(data)
        assert any(frag in e for e in errs), f"{frag} 未被拦截：{errs}"
    has({"basics": {"gender": "x"}}, "gender")
    has({"basics": {"birthMonth": "1995-13"}}, "birthMonth")          # 非法月份
    has({"basics": {"birthMonth": "95-8"}}, "birthMonth")             # 格式
    has({"basics": {"birthMonth": "2099-01"}}, "不能晚于当前月")       # 未来生日（opencode 复核补）
    has({"basics": {"tags": ["a"] * 9}}, "最多 8")
    has({"basics": {"tags": ["x" * 13]}}, "标签过长")
    has({"basics": {"hometown": "城" * 21}}, "hometown 过长")
    has({"education": [{"studyMode": "x"}]}, "studyMode")
    has({"work": [{"description": 123}]}, "work[0].description")
    has({"projects": [{"startDate": "x" * 21}]}, "projects[0].startDate")
    has({"job_intent": "x"}, "job_intent 必须是对象")
    has({"job_intent": {"positions": ["p"] * 6}}, "最多 5")
    has({"job_intent": {"city": "城" * 21}}, "job_intent.city")
    has({"internships": [{}] * 21}, "internships 最多 20")
    has({"internships": ["x"]}, "internships[0] 必须是对象")
    has({"custom_sections": [{"id": "c1"}, {"id": "c1"}]}, "id 必须唯一")
    has({"custom_sections": [{"title": "t" * 11}]}, "title 非法")
    has({"modules_order": ["job_intent", "job_intent"]}, "重复项")
    has({"modules_order": ["unknown_mod"]}, "未知模块")
    has({"modules_order": ["custom:nope"]}, "未引用存在的")
    print("OK: v3 新字段各规则逐条拦截")


def test_new_fields_absent_ok():
    """老数据（无任何新字段）不受影响。"""
    assert validate.validate_resume(RESUME) == []
    print("OK: 老数据无新字段不被误伤")


if __name__ == "__main__":
    test_new_fields_valid_full_roundtrip()
    test_new_fields_reject_each_rule()
    test_new_fields_absent_ok()
    test_sample_is_valid()
    test_root_not_object()
    test_section_not_list()
    test_item_not_dict()
    test_highlights_not_str_list()
    test_basics_shape()
    test_ensure_valid_raises()
    test_pipeline_entry_rejects_malformed()
    test_render_entry_rejects_malformed()
    test_validator_no_crash_on_nonlist_section()
    test_string_field_checks()
    test_length_str_too_long()
    test_length_array_too_long()
    test_length_normal_ok()
    print("\nALL PASS")
