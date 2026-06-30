"""改写 diff —— 把改写前后的**全部字段**差异逐条摊开（P5b 通用递归版）。

兑现「可解释 + 不造假」承诺：改写不是黑盒，用户能逐条看到
  - 哪个字段、从什么改成什么（modified）
  - 哪里删了内容（removed）
  - 哪里新增了内容（added，需重点核对是否编造）

通用递归 diff：覆盖 JSON Resume 任意字段（公司名 / 日期 / URL / 技术栈 / 教育 / 奖项 ...），
不再只盯少数文本字段。纯函数、无依赖，离线可测。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class Change:
    kind: str        # "modified" | "added" | "removed"
    path: str        # 如 "work[0].summary"
    old: str = ""
    new: str = ""


_MISSING = object()  # 区分「键/下标不存在」与「值为 None/空串」


def _disp(v: Any) -> str:
    """叶子的人类可读表示；缺失 / None -> 空串。"""
    if v is _MISSING or v is None:
        return ""
    return str(v)


def diff_json(old: Any, new: Any, path: str = "") -> List[Change]:
    """递归比对任意 JSON 值，产出带点路径的变更清单。

    用 _MISSING 哨兵精确区分「字段不存在」与「值为空」：
    - 原本缺失（_MISSING）-> 有内容：added（净新增，需核对）
    - 原有内容 -> 缺失：removed
    - 两端都存在但展示不同：modified（含「空 -> 有内容」「有内容 -> 空」）
    判等基于「人类可读表示」是否不同，避免 None/"" 互换产生噪声变更。
    """
    changes: List[Change] = []

    if isinstance(old, dict) and isinstance(new, dict):
        for key in list(old.keys()) + [k for k in new.keys() if k not in old]:
            sub = f"{path}.{key}" if path else key
            changes += diff_json(old.get(key, _MISSING), new.get(key, _MISSING), sub)
        return changes
    if isinstance(old, list) and isinstance(new, list):
        for i in range(max(len(old), len(new))):
            o = old[i] if i < len(old) else _MISSING
            n = new[i] if i < len(new) else _MISSING
            changes += diff_json(o, n, f"{path}[{i}]")
        return changes

    # 叶子 / 类型不一致 / 一端缺失
    do, dn = _disp(old), _disp(new)
    if do == dn:
        return changes  # 展示无差异（含 None<->"" 互换、1<->"1" 等）
    label = path or "(root)"
    if old is _MISSING:
        changes.append(Change("added", label, "", dn))
    elif new is _MISSING:
        changes.append(Change("removed", label, do, ""))
    else:  # 两端都存在（含一端为空字符串），算 modified
        changes.append(Change("modified", label, do, dn))
    return changes


def diff_resume(old: Dict[str, Any], new: Dict[str, Any]) -> List[Change]:
    """对比两份 JSON Resume 的全部字段，返回变更清单。"""
    return diff_json(old or {}, new or {})


import re as _re

_CTRL_RE = _re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _safe(s: str) -> str:
    """过滤控制字符并把换行折成空格，防止模型文本伪造审计行（如假的 [增]）。"""
    return _re.sub(r"[\r\n]+", " ", _CTRL_RE.sub("", s))


def format_diff(changes: List[Change], indent: str = "    ") -> List[str]:
    """变更清单 -> 报告行。added 显式标注，提示核对；内容净化防伪造。"""
    if not changes:
        return [f"{indent}（本轮无文本变更）"]
    tag = {"modified": "改", "added": "增", "removed": "删"}
    lines: List[str] = []
    for c in changes:
        path = _safe(c.path)
        if c.kind == "modified":
            lines.append(f"{indent}[{tag[c.kind]}] {path}")
            lines.append(f"{indent}    - {_safe(c.old)}")
            lines.append(f"{indent}    + {_safe(c.new)}")
        elif c.kind == "added":
            lines.append(f"{indent}[{tag[c.kind]}] {path}（新增，请核对是否属实）")
            lines.append(f"{indent}    + {_safe(c.new)}")
        else:
            lines.append(f"{indent}[{tag[c.kind]}] {path}")
            lines.append(f"{indent}    - {_safe(c.old)}")
    return lines
