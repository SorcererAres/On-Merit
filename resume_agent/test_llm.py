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
        make_chat_fn(provider="foobar")
        assert False
    except LLMConfigError as e:
        assert "未知" in str(e)
    print("OK: 未知 provider 报错")


def test_deepseek_without_key_raises():
    try:
        make_chat_fn(provider="deepseek")   # 无 DEEPSEEK_API_KEY
        assert False
    except LLMConfigError as e:
        assert "DEEPSEEK_API_KEY" in str(e)
    print("OK: deepseek 缺 key 报错")


def test_openai_without_base_or_key_raises(monkeypatch_env):
    try:
        make_chat_fn(provider="openai")     # 无 key
        assert False
    except LLMConfigError as e:
        assert "OPENAI_API_KEY" in str(e)
    monkeypatch_env("OPENAI_API_KEY", "sk-x")  # 有 key 无 base
    try:
        make_chat_fn(provider="openai")
        assert False
    except LLMConfigError as e:
        assert "OPENAI_BASE_URL" in str(e)
    print("OK: openai 缺 key/base 报错")


class _FakeResp:
    def __init__(self, status, data=None, text=""):
        self.status_code = status; self._data = data or {}; self.text = text
    def json(self):
        return self._data


def test_openai_chat_fn_request_and_parse(patch_httpx):
    cap = {}
    def fake_post(url, headers=None, json=None, timeout=None, trust_env=None):
        cap["url"] = url; cap["headers"] = headers; cap["json"] = json
        return _FakeResp(200, {"choices": [{"message": {"content": "```json\n{\"a\":1}\n```"}}]})
    patch_httpx(fake_post)
    fn = llm._openai_chat_fn("deepseek-chat", "https://api.deepseek.com/v1", "sk-test")
    out = fn([{"role": "user", "content": "hi"}])
    assert cap["url"] == "https://api.deepseek.com/v1/chat/completions"
    assert cap["headers"]["Authorization"] == "Bearer sk-test"
    assert cap["json"]["model"] == "deepseek-chat" and cap["json"]["messages"][0]["content"] == "hi"
    assert out == '{"a":1}'   # _strip_fence 生效
    print("OK: openai 兼容请求拼装 + 解析 + 去围栏")


def test_openai_chat_fn_errors(patch_httpx):
    import httpx
    # 401 立即报错；429/500 会重试 3 次后抛「多次重试仍失败」
    patch_httpx(lambda url, headers=None, json=None, timeout=None, trust_env=None: _FakeResp(401, {}))
    try:
        llm._openai_chat_fn("m", "https://x/v1", "k")([{"role": "user", "content": "x"}])
        assert False
    except LLMConfigError as e:
        assert "鉴权" in str(e)
    for code in (429, 500):
        patch_httpx(lambda url, headers=None, json=None, timeout=None, trust_env=None, _c=code: _FakeResp(_c, {}))
        try:
            llm._openai_chat_fn("m", "https://x/v1", "k")([{"role": "user", "content": "x"}])
            assert False
        except LLMConfigError as e:
            assert "多次重试" in str(e)
    print("OK: openai 兼容 401 立即报错、429/5xx 重试后失败")


def test_openai_chat_fn_network_error_clean(patch_httpx):
    """连接错误 -> 干净 LLMConfigError，不泄露/不崩溃（覆盖 except 分支）。"""
    import httpx
    def boom(url, headers=None, json=None, timeout=None, trust_env=None):
        raise httpx.ConnectError("Connection refused")
    patch_httpx(boom)
    try:
        llm._openai_chat_fn("m", "https://x/v1", "sk-secret")([{"role": "user", "content": "x"}])
        assert False
    except LLMConfigError as e:
        assert "网络失败" in str(e) and "sk-secret" not in str(e)  # 不泄露 key
    print("OK: 连接错误干净包装、不泄露 key")


def test_openai_error_no_body_leak(patch_httpx):
    """4xx 错误只取 JSON error.message，不回显可能含 Authorization 的原始响应体。"""
    patch_httpx(lambda url, headers=None, json=None, timeout=None, trust_env=None:
                _FakeResp(400, {"error": {"message": "bad request"}}, text="Authorization: Bearer sk-leak"))
    try:
        llm._openai_chat_fn("m", "https://x/v1", "k")([{"role": "user", "content": "x"}])
        assert False
    except LLMConfigError as e:
        assert "bad request" in str(e) and "sk-leak" not in str(e)
    print("OK: 4xx 只取 error.message，不回显响应体")


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
    test_deepseek_without_key_raises()
    env = _Env()
    test_gemini_without_key_raises(env.set)
    env.restore()
    env = _Env()
    test_openai_without_base_or_key_raises(env.set)
    env.restore()
    test_provider_whitespace_normalized()

    # httpx monkeypatch 夹具 + 打桩 sleep（避免重试真等）
    import httpx
    _orig_post, _orig_sleep = httpx.post, llm.time.sleep
    llm.time.sleep = lambda *_: None
    def _patch(fn):
        httpx.post = fn
    try:
        test_openai_chat_fn_request_and_parse(_patch)
        test_openai_chat_fn_errors(_patch)
        test_openai_chat_fn_network_error_clean(_patch)
        test_openai_error_no_body_leak(_patch)
    finally:
        httpx.post = _orig_post
        llm.time.sleep = _orig_sleep
    print("\nALL PASS")
