"""字段级 AI 生成（编辑表单 v3 §4.9）。只有两种诚实形态，绝不据岗位/公司名虚构经历：

- extract（有 source_text 原件）：从原件抽取与本节相关内容整理为 md，**逐句双门槛出处校验**——
  每句须 a) 与原件 bigram 重叠 ≥0.8 或为原件精确子串，且 b) 不含原件没有的数字/英文 token/
  全新中文概念。不达标的句子丢弃；全丢 → 抛错。宁可提取不出，不掺半句假。
- template（无原件）：按 kind 返回**纯骨架**（占位符不含任何具体事实），由用户自己填。

纯逻辑 + 可注入 chat_fn，离线可测。
"""

from __future__ import annotations

import re
from typing import Callable, Dict, List, Optional

from jd_match import _norm, _shingles
from improver import _numbers
from mdtext import strip_md
from polish import _new_terms, _KIND_HINT, VALID_KINDS  # 复用润色的场景提示/新词检测/kind 枚举

ChatFn = Callable[[List[Dict[str, str]]], str]

_EXTRACT_THRESHOLD = 0.8   # 出处 bigram 门槛（比证据判断的 0.6 更严——生成写入简历，不容掺假）

# 无原件时的骨架（占位符不含任何事实；用户填后再润色）
_TEMPLATES: Dict[str, str] = {
    "work": "- **背景**：[一句话说明团队/业务背景]\n- **职责**：[你负责什么]\n- **行动**：[你具体做了什么]\n- **成果**：[可量化的结果，如指标/规模]",
    "internship": "- **背景**：[实习团队/业务背景]\n- **职责**：[你负责什么]\n- **行动**：[你具体做了什么]\n- **成果**：[可量化的结果]",
    "project": "- **背景**：[项目发起原因]\n- **任务**：[你要解决的问题]\n- **行动**：[你的具体方案与执行]\n- **成果**：[可量化的结果]",
    "activity": "- **背景**：[组织/活动背景]\n- **职责**：[你担任的角色与职责]\n- **行动**：[你组织/推动了什么]\n- **成果**：[影响或结果]",
    "thesis": "- **课题背景**：[研究问题与意义]\n- **方法**：[采用的方法/数据]\n- **结论**：[主要发现]\n- **成果**：[论文/评级/应用]",
    "competition": "- **赛事**：[竞赛名称与级别]\n- **任务**：[你负责的部分]\n- **方案**：[你的思路与实现]\n- **名次**：[获得的奖项/排名]",
    "edu": "- **主修课程**：[核心课程]\n- **成绩**：[排名/绩点，如有]\n- **论文/项目**：[题目与内容]\n- **奖项**：[奖学金/荣誉，如有]",
    "summary": "- **专业定位**：[一句话概括你的方向与年限]\n- **核心证据**：[最有说服力的 1–2 项成果]\n- **求职意向**：[目标岗位与价值主张]",
    "skills": "**分组一（如：编程语言）**\n- [技能]：[熟练度/场景]\n\n**分组二（如：工具/平台）**\n- [技能]：[熟练度/场景]",
    "custom": "- [要点一]\n- [要点二]\n- [要点三]",
}

GENERATE_SYSTEM = (
    "你是简历内容整理助手。你的唯一任务是从用户提供的<原件>里，抽取与指定小节相关的内容，"
    "整理成简洁的简历条目（Markdown 列表）。\n"
    "**铁律**：只能用<原件>里已经出现的事实——不得编造、不得补充<原件>没有的数字/技术/公司/客户/"
    "职责/奖项，不得根据小节名或岗位臆想内容。若<原件>里没有与该小节相关的内容，就只回复：无。\n"
    "只输出整理后的正文，不要解释、不要代码围栏、不要 JSON。"
)


def _sentences(md: str) -> List[str]:
    """把 md 拆成句/行单元（先剥标记），用于逐句出处校验。"""
    plain = strip_md(md)
    parts: List[str] = []
    for line in plain.split("\n"):
        parts += [p for p in re.split(r"[。！？;；]", line) if p.strip()]
    return [p.strip() for p in parts if p.strip()]


def _sentence_grounded(sent: str, src: str, src_norm: str, src_shingles: set) -> bool:
    """单句双门槛：a) 几何出处（精确子串 或 bigram≥0.8）且 b) 无原件没有的数字/新词。"""
    e = _norm(sent)
    if not e:
        return False
    geo = (e in src_norm)
    if not geo:
        sh = _shingles(sent)
        geo = bool(sh) and (len(sh & src_shingles) / len(sh) >= _EXTRACT_THRESHOLD)
    if not geo:
        return False
    if _numbers(sent) - _numbers(src):        # 出现原件没有的数字
        return False
    if _new_terms(src, sent):                 # 出现原件没有的英文/全新中文概念
        return False
    return True


def generate_field(kind: str, chat_fn: ChatFn, source_text: Optional[str] = None,
                   entry_context: Optional[str] = None) -> Dict[str, object]:
    """返回 {mode: 'extract'|'template', md}。extract 全句被丢 → 抛 ValueError（端点转 400）。"""
    src = (source_text or "").strip()
    if len(src) < 20:                          # 无（或近乎无）原件 → 骨架
        return {"mode": "template", "md": _TEMPLATES.get(kind, _TEMPLATES["custom"])}

    hint = _KIND_HINT.get(kind, "该小节")
    ctx = f"\n本条目已填字段（供定位相关内容，不是可编造的素材）：{entry_context}\n" if (entry_context or "").strip() else ""
    user = f"请从<原件>里抽取与「{hint}」相关的内容整理成条目：{ctx}\n<原件>\n{src}\n</原件>"
    raw = chat_fn([{"role": "system", "content": GENERATE_SYSTEM},
                   {"role": "user", "content": user}]).strip()
    if not raw or raw.strip() in ("无", "无。", "None", "none"):
        raise ValueError("原件中未找到与该小节相关的内容")

    src_norm, src_shingles = _norm(src), _shingles(src)
    kept: List[str] = []
    for line in raw.split("\n"):
        if not line.strip():
            kept.append("")
            continue
        # 整行按句校验：任一句不达标则整行丢弃（宁缺毋滥）
        sents = _sentences(line)
        if sents and all(_sentence_grounded(s, src, src_norm, src_shingles) for s in sents):
            kept.append(line)
    md = "\n".join(kept).strip()
    md = re.sub(r"\n{3,}", "\n\n", md)
    if not strip_md(md):
        raise ValueError("原件中未找到可靠出处的相关内容（已丢弃全部不达标句子）")
    return {"mode": "extract", "md": md}
