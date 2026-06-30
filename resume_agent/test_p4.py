"""P4 测试：严格 highlights + 适配层扩展（volunteer/certificates）+ metrics 派生。"""

import copy
import json
from pathlib import Path

from improver import improve, validate_no_fabrication
import kami_adapter

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
    "areas_for_improvement": ["x"],
}


def test_strict_highlights_blocks_net_new():
    """严格模式：净新增 highlight -> error 回退；非严格 -> 接受。"""
    def add_highlight(messages):
        r = copy.deepcopy(RESUME)
        r["work"][0]["highlights"].append("新增的一条要点")  # 净新增
        return json.dumps(r, ensure_ascii=False)

    strict = improve(RESUME, EVAL, add_highlight, strict_highlights=True)
    assert strict.accepted is False
    assert any(v.kind == "more_highlights" for v in strict.violations)
    assert len(strict.resume["work"][0]["highlights"]) == 2  # 回退

    loose = improve(RESUME, EVAL, add_highlight, strict_highlights=False)
    assert loose.accepted is True
    assert len(loose.resume["work"][0]["highlights"]) == 3  # 接受
    print("OK: strict_highlights 可配置严格度")


def test_strict_allows_rephrase():
    """严格模式仍允许等量改写（不增条数）。"""
    def rephrase(messages):
        r = copy.deepcopy(RESUME)
        r["work"][0]["highlights"][0] = "改写但不新增"
        return json.dumps(r, ensure_ascii=False)

    res = improve(RESUME, EVAL, rephrase, strict_highlights=True)
    assert res.accepted is True
    print("OK: 严格模式不误伤等量改写")


def test_volunteer_and_certificates_render():
    r = copy.deepcopy(RESUME)
    r["volunteer"] = [
        {"organization": "开源社区", "position": "维护者", "summary": "维护文档",
         "highlights": ["合并 30 个 PR"]}
    ]
    r["certificates"] = [
        {"name": "AWS 认证", "issuer": "Amazon", "date": "2023", "url": "https://x"}
    ]
    html = kami_adapter.render_html(r, lang="zh")
    assert "志愿经历" in html and "开源社区" in html
    assert "证书" in html and "AWS 认证" in html
    print("OK: volunteer / certificates 渲染")


def test_metrics_derive():
    # sample 含 98%、5 万、1200、22 分等 -> 至少 3 个，应渲染 metrics 带
    metrics = kami_adapter.derive_metrics(RESUME)
    assert len(metrics) >= 3
    html = kami_adapter.render_html(RESUME)
    assert 'class="metrics"' in html
    print(f"OK: metrics 派生 {len(metrics)} 个并渲染")


def test_publications_and_languages_render():
    r = copy.deepcopy(RESUME)
    r["publications"] = [
        {"name": "大模型文档自动化实践", "publisher": "某会议", "releaseDate": "2024",
         "url": "https://x", "summary": "介绍闭环方法"}
    ]
    r["languages"] = [
        {"language": "中文", "fluency": "母语"},
        {"language": "英文", "fluency": "流利"},
    ]
    html = kami_adapter.render_html(r, lang="zh")
    assert "发表" in html and "大模型文档自动化实践" in html
    assert "语言" in html and "英文（流利）" in html
    print("OK: publications / languages 渲染")


def test_metrics_explicit_override():
    """meta.metrics 显式指定时优先于启发式派生。"""
    r = {"basics": {"name": "X"},
         "meta": {"metrics": [
             {"value": "50,000", "unit": "+", "label": "平台用户"},
             {"value": "500", "unit": "%", "label": "效率提升"},
             {"value": "36.5", "unit": "%", "label": "满意度增长"},
         ]}}
    html = kami_adapter.render_html(r)
    assert 'class="metrics"' in html
    assert "平台用户" in html and "满意度增长" in html
    assert "50,000" in html
    print("OK: meta.metrics 显式覆盖")


def test_metrics_skip_when_weak():
    # 没有量化数字 -> 不渲染 metrics 带
    plain = {"basics": {"name": "无数字", "summary": "我是一个普通工程师"}}
    assert kami_adapter.derive_metrics(plain) == []
    assert 'class="metrics"' not in kami_adapter.render_html(plain)
    print("OK: 弱信号不渲染 metrics")


def test_safe_url_blocks_dangerous_schemes():
    assert kami_adapter.safe_url("https://x.com") == "https://x.com"
    assert kami_adapter.safe_url("mailto:a@b.com") == "mailto:a@b.com"
    assert kami_adapter.safe_url("github.com/x") == "https://github.com/x"  # 裸域补 https
    assert kami_adapter.safe_url("javascript:alert(1)") == ""  # 拒绝
    assert kami_adapter.safe_url("data:text/html,<script>") == ""
    # link() 不安全时降级为纯文本，不生成 <a>
    assert kami_adapter.link("javascript:alert(1)", "点我") == "点我"
    assert "<a" in kami_adapter.link("https://x.com", "站点")
    print("OK: safe_url 挡 javascript/data，降级纯文本")


def test_xss_url_not_rendered_as_link():
    r = {"basics": {"name": "攻击者", "url": "javascript:alert(document.cookie)"}}
    html = kami_adapter.render_html(r)
    assert "javascript:" not in html  # 危险 scheme 不出现在输出
    print("OK: 恶意 URL 不进入渲染")


def test_i18n_section_titles():
    """--lang en/ko 时正文 section 标题与行内标签本地化（P5b）。"""
    # endDate 留空 -> 触发本地化的「至今/Present/현재」
    r = {"basics": {"name": "X", "summary": "s"},
         "work": [{"name": "A", "position": "p", "startDate": "2023",
                   "summary": "做事", "highlights": ["成果一"]}]}
    zh = kami_adapter.render_html(r, lang="zh")
    en = kami_adapter.render_html(r, lang="en")
    ko = kami_adapter.render_html(r, lang="ko")
    assert "工作经历" in zh and "至今" in zh and "职责" in zh
    assert "Experience" in en and "Present" in en and "工作经历" not in en
    assert "Role" in en and "Impact" in en          # 行内标签也切换
    assert "경력" in ko and "현재" in ko
    print("OK: 多语言文案表（en/ko 正文本地化）")


if __name__ == "__main__":
    test_strict_highlights_blocks_net_new()
    test_strict_allows_rephrase()
    test_volunteer_and_certificates_render()
    test_publications_and_languages_render()
    test_metrics_derive()
    test_metrics_explicit_override()
    test_metrics_skip_when_weak()
    test_safe_url_blocks_dangerous_schemes()
    test_xss_url_not_rendered_as_link()
    test_i18n_section_titles()
    print("\nALL PASS")
