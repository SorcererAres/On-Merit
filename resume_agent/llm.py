"""自包含 LLM provider：把 Ollama / Gemini / OpenAI 兼容(含 DeepSeek) 包成统一 chat_fn。

不依赖任何外部 clone。默认走 Ollama 本地兜底；配了 key 可切托管 API（DeepSeek 等）。

chat_fn 约定：输入 OpenAI 风格 messages（role: system/user/assistant），返回模型文本
（已去掉「开头的 <think> 块」与「包裹整段的单层 markdown 围栏」）。

配置（在 make_chat_fn 调用时读取，便于测试动态改环境）：
  LLM_PROVIDER = ollama | gemini | openai | deepseek   （默认 ollama）
  OLLAMA_MODEL / GEMINI_MODEL / OPENAI_MODEL           （各自默认；model_name 显式覆盖优先）
  GEMINI_API_KEY                                        （gemini 必需）
  OPENAI_BASE_URL / OPENAI_API_KEY                      （openai 兼容：qwen/GLM/OpenAI/Kimi…）
  DEEPSEEK_API_KEY / DEEPSEEK_MODEL                      （deepseek 便捷预设，base_url 已内置）
"""

from __future__ import annotations

import os
import re
import time
from typing import Callable, Dict, List

ChatFn = Callable[[List[Dict[str, str]]], str]


def _ensure_localhost_no_proxy() -> None:
    """让本地 Ollama(127.0.0.1) 绕过系统 HTTP 代理（如 Surge），否则会被代理拦截 refused。
    仅在真正要调 Ollama 时调用（避免 import llm 就污染全局 os.environ）。"""
    for k in ("NO_PROXY", "no_proxy"):
        v = os.environ.get(k, "")
        if "127.0.0.1" not in v:
            os.environ[k] = (v + ",127.0.0.1,localhost,::1").strip(",")

DEFAULT_OLLAMA_MODEL = "gemma3:4b"
DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_DEEPSEEK_MODEL = "deepseek-chat"
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
_VALID_PROVIDERS = ("ollama", "gemini", "openai", "deepseek")

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
        _ensure_localhost_no_proxy()  # 调 Ollama 前才设 NO_PROXY（避免 import 期全局副作用）
        import ollama  # 懒加载：仅在真正调用时才需要 ollama 包
        try:
            resp = ollama.chat(
                model=model,
                messages=messages,
                options={"temperature": 0.3, "top_p": 0.9, "num_ctx": 32768},
            )
        except Exception as e:  # 连接失败/被代理拦截/模型不存在 -> 干净短提示
            msg = " ".join(str(e).split())[:180]
            raise LLMConfigError(
                f"无法调用本地模型 Ollama（127.0.0.1:11434，model={model}）：{msg}。"
                "请确认 `ollama serve` 在运行、模型已拉取，且本地请求未被系统代理（如 Surge）拦截。"
            ) from None
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


def _openai_chat_fn(model: str, base_url: str, api_key: str) -> ChatFn:
    """OpenAI 兼容 Chat Completions（DeepSeek/通义/GLM/OpenAI/Kimi 等）。

    用 httpx（免加新依赖）POST {base_url}/chat/completions，Bearer 鉴权，messages 原样传。
    外网 API 走系统代理（trust_env 默认）。错误清晰映射为 LLMConfigError。
    """
    url = base_url.rstrip("/") + "/chat/completions"

    def _safe_err(resp) -> str:
        """从 JSON 取 error.message，避免把可能回显 Authorization 头的原始响应体塞进异常。"""
        try:
            j = resp.json()
            m = (j.get("error") or {}).get("message") if isinstance(j, dict) else None
            return " ".join(str(m).split())[:160] if m else ""
        except Exception:
            return ""

    def chat_fn(messages: List[Dict[str, str]]) -> str:
        import httpx  # 懒加载（fastapi/ollama 已带 httpx）
        last = ""
        for attempt in range(3):  # 429/超时/5xx 瞬时错误 -> 指数退避重试
            try:
                resp = httpx.post(
                    url,
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={"model": model, "messages": messages, "temperature": 0.2, "stream": False},
                    timeout=httpx.Timeout(120.0, connect=10.0),
                    trust_env=True,  # 外网 API 走系统代理；NO_PROXY 只作用于 localhost
                )
            except httpx.TimeoutException:
                last = "超时"
                time.sleep(2 ** attempt)
                continue
            except Exception as e:  # 连接错误等 -> 不重试（可能地址/网络问题），干净短提示
                raise LLMConfigError(
                    f"调用 {base_url}（model={model}）网络失败：{' '.join(str(e).split())[:120]}") from None

            code = resp.status_code
            if code == 401:
                raise LLMConfigError(f"{base_url} 鉴权失败（401）：API key 无效或已过期")
            if code == 429 or code >= 500:  # 限流/服务端瞬时 -> 重试
                last = f"{code}"
                time.sleep(2 ** attempt)
                continue
            if code >= 400:
                d = _safe_err(resp)
                raise LLMConfigError(f"{base_url} 返回 {code}" + (f"：{d}" if d else ""))
            try:
                content = resp.json()["choices"][0]["message"]["content"]
            except (KeyError, IndexError, ValueError, TypeError) as e:
                raise LLMConfigError(f"{base_url} 响应结构异常（model={model}）：{e}") from None
            if not isinstance(content, str) or not content.strip():
                raise LLMConfigError(f"{base_url} 返回空内容（model={model}）")
            return _strip_fence(content)

        raise LLMConfigError(f"{base_url} 多次重试仍失败（model={model}，最后：{last}）")

    return chat_fn


def make_chat_fn(model_name: str | None = None, provider: str | None = None) -> ChatFn:
    """构造 chat_fn。配置错误立即抛 LLMConfigError，不静默回退。

    - provider 缺省读 LLM_PROVIDER（默认 ollama）；未知值/空白 -> 报错。
    - 显式选 gemini 但缺 GEMINI_API_KEY -> 报错（不偷偷切 Ollama）。
    - model_name 显式给则原样透传；否则按 provider 取各自默认模型。
    """
    prov = (provider or os.getenv("LLM_PROVIDER") or "ollama").strip().lower() or "ollama"  # 空值也回退 ollama
    if prov not in _VALID_PROVIDERS:
        raise LLMConfigError(f"未知 LLM_PROVIDER：{prov!r}，可选 {_VALID_PROVIDERS}")

    if prov == "gemini":
        key = (os.getenv("GEMINI_API_KEY") or "").strip()
        if not key:
            raise LLMConfigError("选择 gemini 但 GEMINI_API_KEY 缺失或为空白")
        return _gemini_chat_fn(model_name or os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL), key)

    if prov == "deepseek":
        key = (os.getenv("DEEPSEEK_API_KEY") or "").strip()
        if not key:
            raise LLMConfigError("选择 deepseek 但 DEEPSEEK_API_KEY 缺失或为空白")
        return _openai_chat_fn(
            model_name or os.getenv("DEEPSEEK_MODEL", DEFAULT_DEEPSEEK_MODEL), DEEPSEEK_BASE_URL, key)

    if prov == "openai":
        key = (os.getenv("OPENAI_API_KEY") or "").strip()
        base = (os.getenv("OPENAI_BASE_URL") or "").strip()
        if not key:
            raise LLMConfigError("选择 openai 但 OPENAI_API_KEY 缺失或为空白")
        if not base:
            raise LLMConfigError("选择 openai 但 OPENAI_BASE_URL 缺失（如 https://api.openai.com/v1）")
        return _openai_chat_fn(model_name or os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL), base, key)

    return _ollama_chat_fn(model_name or os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL))
