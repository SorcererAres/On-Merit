"""patcher.py 离线测试：验证 patch-only 架构让结构造假物理不可能。"""

import copy
import json
from pathlib import Path

from patcher import (
    editable_paths,
    apply_patches,
    improve_via_patch,
    _path_exists,
)

RESUME = json.loads((Path(__file__).parent / "sample_resume.json").read_text("utf-8"))

EVAL = {
    "scores": {
        "open_source": {"score": 8, "max": 35, "evidence": "x"},
        "self_projects": {"score": 22, "max": 30, "evidence": "x"},
        "production": {"score": 12, "max": 25, "evidence": "x"},
        "technical_skills": {"score": 8, "max": 10, "evidence": "x"},
    },
    "bonus_points": {"total": 0, "breakdown": ""},
    "deductions": {"total": 0, "reasons": ""},
    "key_strengths": ["x"],
    "areas_for_improvement": ["职责量化"],
}


def test_editable_paths_enumerates_text_fields_only():
    paths = editable_paths(RESUME)
    assert "basics.summary" in paths
    assert "work[0].summary" in paths
    assert "work[0].highlights[0]" in paths
    assert "projects[0].description" in paths
    assert "skills[1].level" in paths
    # 结构字段不在可编辑列表
    assert not any("name" in p or "url" in p or "startDate" in p for p in paths)
    print(f"OK: 枚举可编辑文本字段 {len(paths)} 个")


def test_legit_patch_applied():
    out = apply_patches(RESUME, [
        {"path": "work[0].summary", "text": "主导平台核心链路。"},
    ])
    assert out.applied == ["work[0].summary"]
    assert out.resume["work"][0]["summary"] == "主导平台核心链路。"
    assert not out.rejected
    print("OK: 合法补丁被应用")


def test_structural_fabrication_impossible():
    """改公司名 / 加 bullet / 越界下标 / 改 URL 的补丁一律被拒，原简历不变。"""
    out = apply_patches(RESUME, [
        {"path": "work[0].name", "text": "谷歌"},                 # 结构字段，无路径
        {"path": "work[0].url", "text": "javascript:alert(1)"},   # 结构字段
        {"path": "work[0].highlights[9]", "text": "凭空要点"},     # 越界 -> 禁止追加
        {"path": "work[5].summary", "text": "不存在的公司"},        # 越界条目
        {"path": "education[0].institution", "text": "野鸡大学"},   # 不可编辑 section
    ])
    assert out.applied == []
    assert len(out.rejected) == 5
    assert out.resume["work"][0]["name"] == "某科技公司"          # 公司名没动
    assert len(out.resume["work"][0]["highlights"]) == 2          # 没新增 bullet
    print("OK: 结构造假物理不可能（5 个越权补丁全被拒）")


def test_path_exists_guards():
    assert _path_exists(RESUME, "basics.summary") is True
    assert _path_exists(RESUME, "work[0].highlights[1]") is True
    assert _path_exists(RESUME, "work[0].highlights[2]") is False  # 只有 2 条
    assert _path_exists(RESUME, "work[0].name") is False
    assert _path_exists(RESUME, "evil[0].x") is False
    print("OK: 路径存在性 + 白名单守卫")


def test_improve_via_patch_legit():
    def fake_chat(messages):
        return json.dumps([
            {"path": "work[0].summary", "text": "主导 Agent 平台从架构到上线。"},
            {"path": "basics.summary", "text": "AI/Agent 工程师，专注大模型应用。"},
        ], ensure_ascii=False)

    res = improve_via_patch(RESUME, EVAL, fake_chat)
    assert res.accepted is True
    assert "主导 Agent 平台" in res.resume["work"][0]["summary"]
    print("OK: improve_via_patch 合法改写")


def test_improve_via_patch_new_number_rejected():
    def fake_chat(messages):
        return json.dumps([
            {"path": "work[0].summary", "text": "服务 888888 名用户。"}  # 凭空数字
        ], ensure_ascii=False)

    res = improve_via_patch(RESUME, EVAL, fake_chat)               # 默认严格
    assert res.accepted is False
    assert any(v.kind == "new_number" and v.severity == "error" for v in res.violations)
    assert "888888" not in json.dumps(res.resume, ensure_ascii=False)  # 回退
    print("OK: 补丁凭空数字默认 error 回退")


def test_improve_via_patch_rejects_bad_paths_but_keeps_good():
    """混合补丁：越权的被拒（warn），合法的仍应用。"""
    def fake_chat(messages):
        return json.dumps([
            {"path": "work[0].name", "text": "微软"},                  # 拒
            {"path": "work[0].summary", "text": "主导核心链路。"},       # 应用
        ], ensure_ascii=False)

    res = improve_via_patch(RESUME, EVAL, fake_chat)
    assert res.accepted is True
    assert res.resume["work"][0]["name"] == "某科技公司"               # 越权无效
    assert res.resume["work"][0]["summary"] == "主导核心链路。"        # 合法生效
    assert any(v.kind == "patch_rejected" for v in res.violations)
    print("OK: 越权补丁被拒、合法补丁保留")


def test_none_field_not_editable():
    """Codex 复核：值为 None 的字段不被枚举，也不能被补丁凭空补出文本。"""
    r = {"work": [{"name": "A", "summary": None}]}
    assert "work[0].summary" not in editable_paths(r)
    assert _path_exists(r, "work[0].summary") is False
    out = apply_patches(r, [{"path": "work[0].summary", "text": "凭空职责"}])
    assert out.applied == [] and out.resume["work"][0]["summary"] is None
    print("OK: None 字段不可补（白名单漏洞已堵）")


def test_regex_alias_rejected():
    """Codex 复核：work[00] 这类正则别名被精确白名单拒绝。"""
    r = {"work": [{"summary": "x"}]}
    assert _path_exists(r, "work[00].summary") is False
    out = apply_patches(r, [{"path": "work[00].summary", "text": "别名注入"}])
    assert out.applied == [] and out.resume["work"][0]["summary"] == "x"
    print("OK: 索引别名被拒")


def test_non_dict_patch_element_no_crash():
    """Codex 复核：补丁元素非 dict（字符串/数字/列表）不再崩溃，被拒。"""
    out = apply_patches({"work": [{"summary": "x"}]},
                        ["我是字符串", 123, ["x"], None,
                         {"path": "work[0].summary", "text": "合法"}])
    assert out.resume["work"][0]["summary"] == "合法"
    assert len(out.rejected) == 4
    print("OK: 非法补丁元素被拒、不崩溃")


def test_patch_text_sanitized():
    """Codex 复核：补丁文本里的换行/控制字符被净化，防伪造多条 bullet。"""
    out = apply_patches({"work": [{"highlights": ["a"]}]},
                        [{"path": "work[0].highlights[0]", "text": "成果一\n成果二\x07"}])
    val = out.resume["work"][0]["highlights"][0]
    assert "\n" not in val and "\x07" not in val
    print(f"OK: 补丁文本净化 -> {val!r}")


def test_malformed_resume_no_crash():
    """畸形结构（section 非 list、item 非 dict）不崩溃。"""
    assert editable_paths({"work": "not a list"}) == []
    assert editable_paths({"work": ["str", 1, {"summary": "ok"}]}) == ["work[2].summary"]
    print("OK: 畸形输入容错（保留原始下标）")


if __name__ == "__main__":
    test_editable_paths_enumerates_text_fields_only()
    test_none_field_not_editable()
    test_regex_alias_rejected()
    test_non_dict_patch_element_no_crash()
    test_patch_text_sanitized()
    test_malformed_resume_no_crash()
    test_legit_patch_applied()
    test_structural_fabrication_impossible()
    test_path_exists_guards()
    test_improve_via_patch_legit()
    test_improve_via_patch_new_number_rejected()
    test_improve_via_patch_rejects_bad_paths_but_keeps_good()
    print("\nALL PASS")
