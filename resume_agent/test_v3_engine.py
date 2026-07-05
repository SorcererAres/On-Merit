"""编辑表单 v3 · 引擎接入点（E1c）：新字段进评分文本/证据，公平性边界不破。离线。"""

import evaluate as ev
import rubrics
import patcher as P
from mdtext import strip_md


def test_strip_md():
    assert strip_md("- **QPS** 从 2k 到 8k\n- 拆分 3 个") == "QPS 从 2k 到 8k\n拆分 3 个"
    assert strip_md("## 标题\n*斜体*文本") == "标题\n斜体文本"
    assert strip_md(None) == "" and strip_md(123) == ""
    print("OK: strip_md 剥标记")


_R = {
    "basics": {"name": "张三", "gender": "male", "hometown": "北京", "tags": ["设计"], "summary": "**5 年**经验"},
    "work": [{"name": "A", "position": "后端", "description": "- QPS 2k→8k\n- 拆 3 服务",
              "summary": "旧摘要", "highlights": ["旧要点"]}],
    "internships": [{"name": "实习厂", "description": "参与 X 项目"}],
    "organizations": [{"name": "社团", "role": "部长", "description": "办了 5 场活动"}],
    "skills_md": "- **Python** 高级", "skills": [{"name": "旧技能", "keywords": ["旧关键词"]}],
    "education": [{"studyType": "本科", "area": "设计", "institution": "某校", "description": "主修课程 A"}],
    "job_intent": {"positions": ["产品经理"], "city": "上海"},
    "custom_sections": [{"id": "c1", "title": "个人信息", "content": "95后 女性 北京人"}],
    "awards": [{"title": "一等奖", "awarder": "学校", "date": "2023", "summary": "说明"}],
}


def test_new_fields_enter_text_description_priority():
    t = ev.resume_to_text(_R)
    for frag in ("QPS 2k→8k", "拆 3 服务", "参与 X 项目", "办了 5 场活动",
                 "Python 高级", "主修课程 A", "一等奖"):
        assert frag in t, f"{frag} 未进评分文本"
    # description 存在 → 旧字段忽略；skills_md 优先 → 旧 skills 忽略
    assert "旧摘要" not in t and "旧要点" not in t and "旧技能" not in t and "旧关键词" not in t
    print("OK: 新字段进文本 + description/skills_md 优先")


def test_fairness_boundary_holds():
    t = ev.resume_to_text(_R)
    for banned in ("张三", "北京", "95后", "女性", "产品经理", "上海", "个人信息", "某校"):
        assert banned not in t, f"{banned} 泄漏进评分文本（公平性/意向/自定义边界）"
    print("OK: 姓名/地域/性别/求职意向/自定义节 均不进评分语料")


def test_rubrics_quantified_reads_description():
    r2 = {"work": [{"name": "A", "description": "平台用户突破 50,000+，效率提升 500%"}]}
    assert rubrics._has_quantified_impact(r2)
    # 无 description 回退旧 highlights 仍有效
    r3 = {"work": [{"name": "B", "highlights": ["QPS 提升 300%"]}]}
    assert rubrics._has_quantified_impact(r3)
    print("OK: 量化影响读 description（回退旧字段仍有效）")


def test_patcher_new_md_paths_and_priority():
    r = {"work": [{"name": "A", "description": "负责后端服务，QPS 提升三倍以上",
                   "summary": "旧摘要够长的内容", "highlights": ["旧要点内容够长"]}],
         "skills_md": "精通 Python 与 Go 语言开发",
         "education": [{"institution": "某校", "description": "主修课程与毕业论文相关内容"}],
         "custom_sections": [{"id": "c1", "title": "作品", "content": "开源项目星标超过两千个"}]}
    paths = set(P.editable_paths(r))
    assert {"work[0].description", "skills_md", "education[0].description", "custom_sections[0].content"} <= paths
    assert "work[0].summary" not in paths and "work[0].highlights[0]" not in paths  # description 存在→旧路径不开
    # <10 字不开放
    assert "work[0].description" not in set(P.editable_paths({"work": [{"name": "B", "description": "短"}]}))
    # 无 description 回退旧字段
    p3 = set(P.editable_paths({"work": [{"name": "C", "summary": "较长的旧摘要内容在此", "highlights": ["够长的旧要点内容"]}]}))
    assert "work[0].summary" in p3 and "work[0].highlights[0]" in p3
    print("OK: patcher 新 md 路径 + description 优先 + ≥10 门槛 + 回退")


def test_patcher_md_keeps_newline_highlights_fold():
    r = {"work": [{"name": "A", "description": "负责后端服务，QPS 提升三倍以上",
                   "highlights": ["够长的旧要点"]}],
         "skills_md": "精通 Python 与 Go 语言开发"}
    out = P.apply_patches(r, [{"path": "work[0].description", "text": "- 第一行\n- 第二行"}])
    assert "\n" in out.resume["work"][0]["description"] and out.applied == ["work[0].description"]
    # highlights 折叠换行（防伪造多条）
    r2 = {"work": [{"name": "C", "highlights": ["够长的旧要点内容"]}]}
    outh = P.apply_patches(r2, [{"path": "work[0].highlights[0]", "text": "多\n行\n伪造"}])
    assert "\n" not in outh.resume["work"][0]["highlights"][0]
    # skills_md 写入 + 越权拒绝
    outs = P.apply_patches(r, [{"path": "skills_md", "text": "- Python\n- Go"}])
    assert "\n" in outs.resume["skills_md"]
    assert P.apply_patches(r, [{"path": "work[0].name", "text": "改名"}]).applied == []
    print("OK: md 保留换行 / highlights 折叠 / skills_md 写入 / 越权拒绝")


if __name__ == "__main__":
    test_strip_md()
    test_new_fields_enter_text_description_priority()
    test_fairness_boundary_holds()
    test_rubrics_quantified_reads_description()
    test_patcher_new_md_paths_and_priority()
    test_patcher_md_keeps_newline_highlights_fold()
    print("\nALL PASS")
