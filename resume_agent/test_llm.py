"""llm.py 离线测试（不连真实模型，只测配置选择与文本清洗）。"""

import os

import llm
from llm import _strip_fence, make_chat_fn, LLMConfigError


def test_strip_fence_basic():
    assert _strip_fence('```json\n{"a":1}\n```') == '{"a":1}'
    assert _strip_fence("  纯文本  ") == "纯文本"
    print("OK: 去围栏 / 纯文本")


def test_strip_fence_lead_think_only():
    assert _strip_fence("<think>推理</think>\n答案") == "答案"
    # 正文中部的 <think> 不应被乱删（无 think 块结构）
    keep = "结果：包含 <think> 字样的描述"
    assert _strip_fence(keep) == keep
    print("OK: 仅去开头 think，不损坏正文")


def test_strip_fence_no_partial_corruption():
    # 非包裹整段的围栏（中间出现）不应被当作 wrapping fence 处理
    s = "前言 ```code``` 后语"
    assert _strip_fence(s) == s
    print("OK: 非包裹围栏不误删")


def test_unknown_provider_raises():
    try:
        make_chat_fn(provider="openai")
        assert False
    except LLMConfigError as e:
        assert "未知" in str(e)
    print("OK: 未知 provider 报错")


def test_gemini_without_key_raises(monkeypatch_env):
    monkeypatch_env("GEMINI_API_KEY", "")
    try:
        make_chat_fn(provider="gemini")
        assert False
    except LLMConfigError as e:
        assert "GEMINI_API_KEY" in str(e)
    # 纯空白 key 也拒绝
    monkeypatch_env("GEMINI_API_KEY", "   ")
    try:
        make_chat_fn(provider="gemini")
        assert False
    except LLMConfigError:
        pass
    print("OK: gemini 缺 key 报错（不静默回退 Ollama）")


def test_provider_whitespace_normalized():
    # 带空格 + 大小写的 provider 归一化；ollama 不需要 key，能构造（不实际调用）
    fn = make_chat_fn(provider="  Ollama  ", model_name="x")
    assert callable(fn)
    print("OK: provider 归一化")


# 极简 env 夹具（不依赖 pytest）
class _Env:
    def __init__(self):
        self.saved = {}
    def set(self, k, v):
        self.saved.setdefault(k, os.environ.get(k))
        os.environ[k] = v
    def restore(self):
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


if __name__ == "__main__":
    test_strip_fence_basic()
    test_strip_fence_lead_think_only()
    test_strip_fence_no_partial_corruption()
    test_unknown_provider_raises()
    env = _Env()
    test_gemini_without_key_raises(env.set)
    env.restore()
    test_provider_whitespace_normalized()
    print("\nALL PASS")
