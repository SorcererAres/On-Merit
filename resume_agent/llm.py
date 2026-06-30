"""自包含 LLM provider：把 Ollama / Gemini 包成统一的 chat_fn。

不依赖任何外部 clone。默认走 Ollama 本地模型；显式选 Gemini 且配了 key 时走 Gemini。

chat_fn 约定：输入 OpenAI 风格 messages（role: system/user/assistant），返回模型文本
（已去掉「开头的 <think> 块」与「包裹整段的单层 markdown 围栏」）。

配置（在 make_chat_fn 调用时读取，便于测试动态改环境）：
  LLM_PROVIDER = ollama | gemini      （默认 ollama）
  OLLAMA_MODEL / GEMINI_MODEL         （各自默认值；--model / model_name 显式覆盖优先）
  GEMINI_API_KEY                       （选 gemini 时必需）
"""

from __future__ import annotations

import os
import re
from typing import Callable, Dict, List

ChatFn = Callable[[List[Dict[str, str]]], str]

DEFAULT_OLLAMA_MODEL = "gemma3:4b"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
_VALID_PROVIDERS = ("ollama", "gemini")

# 仅匹配「响应最开头的一个完整 <think>...</think> 块」
_LEAD_THINK = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)
# 仅匹配「包裹整段的单层 ```lang ... ``` 围栏」
_WRAP_FENCE = re.compile(r"^\s*```[a-zA-Z0-9_-]*\s*\n(.*?)\n?```\s*$", re.DOTALL)


class LLMConfigError(RuntimeError):
    """provider / 模型 / key 配置错误（明确失败，不静默回退）。"""


def _strip_fence(text: str) -> str:
    """去掉开头的 think 块和包裹整段的单层围栏；结构不完整则原样返回（不乱改正文）。"""
    if not isinstance(text, str):
        return ""
    s = _LEAD_THINK.sub("", text, count=1)
    m = _WRAP_FENCE.match(s.strip())
    return (m.group(1) if m else s).strip()


def _ollama_chat_fn(model: str) -> ChatFn:
    def chat_fn(messages: List[Dict[str, str]]) -> str:
        import ollama  # 懒加载：仅在真正调用时才需要 ollama 包
        resp = ollama.chat(
            model=model,
            messages=messages,
            options={"temperature": 0.3, "top_p": 0.9, "num_ctx": 32768},
        )
        try:
            content = resp["message"]["content"]
        except (KeyError, TypeError) as e:
            raise LLMConfigError(f"Ollama 响应结构异常（model={model}）：{e}") from None
        if not isinstance(content, str) or not content.strip():
            raise LLMConfigError(f"Ollama 返回空内容（model={model}）")
        return _strip_fence(content)

    return chat_fn


def _gemini_chat_fn(model: str, api_key: str) -> ChatFn:
    def chat_fn(messages: List[Dict[str, str]]) -> str:
        import google.generativeai as genai  # 懒加载
        genai.configure(api_key=api_key)
        # system 用 system_instruction；user/assistant 映射为 Gemini 的 user/model
        system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
        contents = [
            {"role": "model" if m.get("role") == "assistant" else "user",
             "parts": [m.get("content", "")]}
            for m in messages if m.get("role") in ("user", "assistant")
        ]
        gm = genai.GenerativeModel(
            model_name=model,
            system_instruction=system or None,
            generation_config={"temperature": 0.3, "top_p": 0.9},
        )
        resp = gm.generate_content(contents)
        # 安全拦截 / 空 candidates -> 明确报错（不把简历正文写进异常）
        if not getattr(resp, "candidates", None):
            fb = getattr(resp, "prompt_feedback", None)
            raise LLMConfigError(f"Gemini 无返回（model={model}，feedback={fb}）")
        try:
            text = resp.text
        except Exception as e:
            raise LLMConfigError(f"Gemini 响应无文本（model={model}）：{e}") from None
        if not text or not text.strip():
            raise LLMConfigError(f"Gemini 返回空内容（model={model}）")
        return _strip_fence(text)

    return chat_fn


def make_chat_fn(model_name: str | None = None, provider: str | None = None) -> ChatFn:
    """构造 chat_fn。配置错误立即抛 LLMConfigError，不静默回退。

    - provider 缺省读 LLM_PROVIDER（默认 ollama）；未知值/空白 -> 报错。
    - 显式选 gemini 但缺 GEMINI_API_KEY -> 报错（不偷偷切 Ollama）。
    - model_name 显式给则原样透传；否则按 provider 取各自默认模型。
    """
    prov = (provider or os.getenv("LLM_PROVIDER", "ollama")).strip().lower()
    if prov not in _VALID_PROVIDERS:
        raise LLMConfigError(f"未知 LLM_PROVIDER：{prov!r}，可选 {_VALID_PROVIDERS}")

    if prov == "gemini":
        key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not key:
            raise LLMConfigError("选择 gemini 但 GEMINI_API_KEY 缺失或为空白")
        return _gemini_chat_fn(model_name or os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL), key)

    return _ollama_chat_fn(model_name or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL))
