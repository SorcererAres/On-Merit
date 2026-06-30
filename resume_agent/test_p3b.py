"""brand.py + questionnaire.py 离线测试。"""

import json

import brand as brand_mod
import questionnaire as q
import kami_adapter

SAMPLE_BRAND = """# comment line
---
name: "王二"              # 姓名
role_title: "AI 工程师"
email: "wang@example.com"
website: "wang.dev"
github: "wanger"          # handle only
city: "上海"
language: "cn"
tone: balanced
---

# Habits
- 简历：突出量化结果。
"""


def test_parse_brand():
    b = brand_mod.parse_brand(SAMPLE_BRAND)
    assert b["name"] == "王二"
    assert b["role_title"] == "AI 工程师"
    assert b["github"] == "wanger"
    assert b["language"] == "cn"
    assert "突出量化结果" in b["habits"]
    print("OK: 解析 frontmatter + 去注释 + habits")


def test_apply_brand_fallback_only():
    """已有值不被覆盖，缺失值兜底。"""
    b = brand_mod.parse_brand(SAMPLE_BRAND)
    resume = {"basics": {"name": "李明"}}  # 已有 name
    brand_mod.apply_brand(resume, b)
    assert resume["basics"]["name"] == "李明"          # 不覆盖
    assert resume["basics"]["email"] == "wang@example.com"  # 兜底
    assert resume["basics"]["url"] == "https://wang.dev"
    assert resume["basics"]["location"]["city"] == "上海"
    assert any(p["network"] == "GitHub" for p in resume["basics"]["profiles"])
    print("OK: brand 仅兜底、不覆盖")


def test_brand_defaults():
    b = brand_mod.parse_brand(SAMPLE_BRAND)
    role, lang = brand_mod.brand_defaults(b)
    assert role == "AI 工程师" and lang == "zh"
    print("OK: 派生 role/lang")


def test_no_github_dup():
    b = {"github": "wanger"}
    resume = {"basics": {"profiles": [{"network": "GitHub", "url": "x"}]}}
    brand_mod.apply_brand(resume, b)
    gh = [p for p in resume["basics"]["profiles"] if p["network"] == "GitHub"]
    assert len(gh) == 1  # 不重复添加
    print("OK: 已有 GitHub 不重复")


def test_questionnaire_build():
    r = q.build_resume(
        name="张三", role="后端工程师", email="z@x.com", github="zhangsan",
        work=[{"name": "A 公司", "position": "工程师", "summary": "做后端"}],
        projects=[{"name": "P1", "url": "https://github.com/zhangsan/p1"}],
    )
    assert r["basics"]["name"] == "张三"
    assert r["meta"]["role"] == "后端工程师"
    assert r["basics"]["profiles"][0]["url"] == "https://github.com/zhangsan"
    assert "education" not in r  # 空字段省略
    print("OK: 问卷构建器")


def test_questionnaire_role_flows_to_render():
    """问卷的 role 经 meta 贯通到 Kami 渲染。"""
    r = q.build_resume(name="张三", role="后端工程师")
    html = kami_adapter.render_html(r, lang="zh")
    assert "后端工程师" in html
    print("OK: meta.role 贯通渲染")


def test_questionnaire_interactive():
    """注入假 input，模拟一次完整问答。"""
    answers = iter([
        "陈四",            # 姓名
        "数据工程师",       # 岗位
        "chen@x.com",     # 邮箱
        "",               # 网站(跳过)
        "深圳",            # 城市
        "chensi",         # github
        "专注数据平台",     # 简介
        "B 公司", "数据工程师", "2022", "至今", "搭数据平台",  # 工作1
        "日处理 10 亿条", "",   # 成果(1条) + 空行结束
        "",               # 工作2 公司空 -> 结束工作
        "",               # 项目名空 -> 结束项目
        "",               # 能力名空 -> 结束能力
        "",               # 学校空 -> 结束教育
    ])
    r = q.interactive(input_fn=lambda prompt: next(answers), print_fn=lambda *_: None)
    assert r["basics"]["name"] == "陈四"
    assert "website" not in r["basics"] and "url" not in r["basics"]  # 跳过的网站
    assert r["work"][0]["name"] == "B 公司"
    assert r["work"][0]["highlights"] == ["日处理 10 亿条"]
    print("OK: 交互问答（注入 input）")


def test_brand_end_to_end_render():
    """brand 兜底后，缺失字段经渲染出现在最终 HTML（证明非死代码路径可用）。"""
    b = brand_mod.parse_brand(SAMPLE_BRAND)
    resume = {"basics": {"name": "李明"}, "work": [{"name": "A 公司", "position": "x"}]}
    brand_mod.apply_brand(resume, b)
    role, lang = brand_mod.brand_defaults(b)
    html = kami_adapter.render_html(resume, lang=lang, role=role)
    assert "wang@example.com" in html  # 来自 brand 的邮箱
    assert "上海" in html              # 来自 brand 的城市
    assert "AI 工程师" in html         # 来自 brand 的 role
    print("OK: brand 兜底 -> 渲染贯通")


if __name__ == "__main__":
    test_parse_brand()
    test_apply_brand_fallback_only()
    test_brand_defaults()
    test_no_github_dup()
    test_questionnaire_build()
    test_questionnaire_role_flows_to_render()
    test_questionnaire_interactive()
    test_brand_end_to_end_render()
    print("\nALL PASS")
