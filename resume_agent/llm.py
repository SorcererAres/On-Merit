"""自包含 LLM provider：把 Ollama / Gemini 包成统一的 chat_fn。

不再依赖 hiring-agent 的 llm_utils / models / prompt——本项目自给自足。
默认走 Ollama 本地模型；设 GEMINI_API_KEY 且 provider=gemini 时走 Gemini。

chat_fn 约定：输入 OpenAI 风格 messages，返回模型文本（已去 markdown 代码围栏）。
"""

from __future__ import annotations

import os
import re
from typing import Callable, Dict, List

ChatFn = Callable[[List[Dict[str, str]]], str]

DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "gemma3:4b")
PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()


def _strip_fence(text: str) -> str:
    """去掉 ```json ... ``` 代码围栏与 <think> 块，返回纯净文本。"""
    text = text.strip()
    if "<think>" in text and "</think>" in text:
        text = text[: text.find("<think>")] + text[text.find("</think>") + 8 :]
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        if text.endswith("```"):
            text = text[:-3]
    return text.strip()


def _ollama_chat_fn(model: str) -> ChatFn:
    import ollama

    def chat_fn(messages: List[Dict[str, str]]) -> str:
        resp = ollama.chat(
            model=model,
            messages=messages,
            options={"temperature": 0.3, "top_p": 0.9, "num_ctx": 32768},
        )
        return _strip_fence(resp["message"]["content"])

    return chat_fn


def _gemini_chat_fn(model: str) -> ChatFn:
    import google.generativeai as genai

    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    gm = genai.GenerativeModel(model_name=model)

    def chat_fn(messages: List[Dict[str, str]]) -> str:
        # 把 system 并入首条 user（Gemini 无独立 system role）
        parts = []
        for m in messages:
            prefix = "[系统] " if m["role"] == "system" else ""
            parts.append({"role": "user", "parts": [prefix + m["content"]]})
        resp = gm.generate_content(parts)
        return _strip_fence(resp.text)

    return chat_fn


def make_chat_fn(model_name: str | None = None, provider: str | None = None) -> ChatFn:
    """构造 chat_fn。model_name 缺省取 DEFAULT_MODEL；provider 缺省取环境。

    未知模型名默认路由到 Ollama（与本机已拉取的模型匹配即可）。
    """
    model = model_name or DEFAULT_MODEL
    prov = (provider or PROVIDER).lower()
    if prov == "gemini" and os.getenv("GEMINI_API_KEY"):
        return _gemini_chat_fn(model)
    return _ollama_chat_fn(model)
