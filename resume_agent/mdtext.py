"""受限 Markdown → 纯文本（编辑表单 v3 描述字段喂给评分/匹配前剥标记）。

只处理本项目富文本子集：**加粗** / *斜体* / 无序·有序列表 / 标题。纯函数、无依赖。
目的是让引擎读到「内容文字」，而非 Markdown 符号；不追求完美渲染。
"""

from __future__ import annotations

import re

_BOLD_ITALIC = re.compile(r"(\*\*|\*|__|_)")          # 去成对强调标记
_BULLET = re.compile(r"^\s{0,6}([-*+]|\d+[.)])\s+", re.MULTILINE)  # 行首列表符
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+", re.MULTILINE)          # 行首标题符


def strip_md(md: object) -> str:
    """把受限 Markdown 转为纯文本行（保留换行，剥掉强调/列表/标题符号）。"""
    if not isinstance(md, str):
        return ""
    s = _HEADING.sub("", md)
    s = _BULLET.sub("", s)
    s = _BOLD_ITALIC.sub("", s)
    # 逐行 trim，去空行
    lines = [ln.strip() for ln in s.splitlines()]
    return "\n".join(ln for ln in lines if ln)
