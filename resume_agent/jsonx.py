"""LLM 输出的容错 JSON 解析（分级修复）。

各处 `_parse_*` 原来只做「取首个 { 到末个 }」+ json.loads，遇到模型偶发的
截断/尾逗号/多余围栏就直接失败、白白触发重试。这里集中做分级修复：

  去围栏/开头 think → 字符串感知地定位 JSON 片段 → 截断则补齐未闭合的串/括号
  → 去掉尾逗号 → json.loads（拒绝 NaN/Infinity）。

修复都是「不改变合法 JSON 语义」的保守操作：合法输入原样通过，只有坏输入才被修。
借鉴 JadeAI parse 的思路，但自建、不引第三方依赖。见 COMPETITIVE-JadeAI.md §三B。
"""

from __future__ import annotations

import json
import re
from typing import Any

# 开头一个完整 <think>...</think> 块
_LEAD_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)
# 包裹整段的单层 ```lang ... ``` 围栏
_WRAP_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n?```\s*$", re.DOTALL)
# } 或 ] 前的尾逗号
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")

_OPENERS = {"object": "{", "array": "["}


def _strip_wrappers(text: str) -> str:
    s = _LEAD_THINK.sub("", text, count=1).strip()
    m = _WRAP_FENCE.match(s)
    if m:
        return m.group(1).strip()
    # 非包裹型围栏：去掉最外层出现的 ``` 标记（模型有时只加半边）
    if s.startswith("```"):
        s = s.split("```", 2)[-1] if s.count("```") >= 2 else s.lstrip("`")
        s = re.sub(r"^[a-zA-Z0-9_-]*\n", "", s.strip())
    return s.strip()


def _extract_balanced(s: str, opener: str) -> str | None:
    """从第一个 opener 起，字符串感知地扫描出一段 JSON。

    - 遇到完整闭合就返回该片段（忽略其后多余文字）；
    - 若扫到结尾仍未闭合（截断），补齐未闭合的字符串与括号后返回。
    """
    start = s.find(opener)
    if start == -1:
        return None
    out: list[str] = []
    stack: list[str] = []
    in_str = esc = False
    for c in s[start:]:
        out.append(c)
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "{[":
            stack.append("}" if c == "{" else "]")
        elif c in "}]":
            if stack:
                stack.pop()
            if not stack:
                return "".join(out)  # 完整闭合，丢弃其后杂物
    # 截断：补齐未闭合的字符串和括号
    if in_str:
        out.append('"')
    while stack:
        out.append(stack.pop())
    return "".join(out)


def _no_const(c: str) -> Any:
    raise ValueError(f"非法 JSON 常量：{c}")


def parse_json_lenient(raw: str, root: str = "object") -> Any:
    """容错解析：返回 dict（root='object'）或 list（root='array'）。

    解析/修复后仍失败，或根类型不符，抛 ValueError（供调用方按原逻辑重试）。
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ValueError("空的模型输出，无法解析 JSON")
    opener = _OPENERS.get(root, "{")
    body = _strip_wrappers(raw)
    span = _extract_balanced(body, opener)
    candidate = span if span is not None else body

    for attempt in (candidate, _TRAILING_COMMA.sub(r"\1", candidate)):
        try:
            obj = json.loads(attempt, parse_constant=_no_const)
            break
        except ValueError:
            obj = _MISS
    else:  # 两次都失败
        obj = _MISS
    if obj is _MISS:
        raise ValueError(f"无法解析模型输出为 JSON（root={root}）")

    if root == "object" and not isinstance(obj, dict):
        raise ValueError(f"输出根节点不是 JSON 对象，而是 {type(obj).__name__}")
    if root == "array" and not isinstance(obj, list):
        raise ValueError(f"输出根节点不是 JSON 数组，而是 {type(obj).__name__}")
    return obj


_MISS = object()
