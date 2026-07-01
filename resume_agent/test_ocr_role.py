"""OCR / 岗位检测新增能力的离线测试（不连真实模型/网络）。"""

import ingest
import role_detect
import llm


# --------------------------- 图片 MIME 嗅探 --------------------------------- #
def test_img_mime_sniff():
    assert llm._img_mime(b"\x89PNG\r\n\x1a\n....") == "image/png"
    assert llm._img_mime(b"\xff\xd8\xff\xe0....") == "image/jpeg"
    assert llm._img_mime(b"RIFF\x00\x00\x00\x00WEBP") == "image/webp"
    assert llm._img_mime(b"unknownbytes") == "image/png"  # 兜底 PNG
    print("OK: 图片 MIME 嗅探")


def test_vision_no_key_raises(monkeypatch_env):
    monkeypatch_env("QWEN_API_KEY", "")
    monkeypatch_env("DASHSCOPE_API_KEY", "")
    try:
        llm.make_vision_ocr_fn()
        assert False
    except llm.LLMConfigError as e:
        assert "QWEN_API_KEY" in str(e)
    print("OK: 视觉 OCR 缺 key 干净报错")


# --------------------------- source_to_text 路由 --------------------------- #
def test_source_to_text_image_needs_ocr(tmp_png):
    # 图片文件但未配 ocr_fn -> 明确报错
    try:
        ingest.source_to_text(tmp_png, ocr_fn=None)
        assert False
    except ValueError as e:
        assert "视觉 OCR" in str(e)
    # 配了 ocr_fn -> 走 OCR，返回 (文本, True)
    text, used = ingest.source_to_text(tmp_png, ocr_fn=lambda imgs, prompt: "识别出的简历文本")
    assert used is True and text == "识别出的简历文本"
    print("OK: 图片走 OCR 分支")


def test_ocr_images_empty_result_fails():
    try:
        ingest.ocr_images([b"x"], ocr_fn=lambda imgs, prompt: "   ")
        assert False
    except ValueError as e:
        assert "未识别" in str(e)
    print("OK: OCR 空结果判失败")


# --------------------------- 岗位 key 归一化 ------------------------------- #
def test_clean_key():
    assert role_detect._clean_key("designer") == "designer"
    assert role_detect._clean_key("`designer`") == "designer"
    assert role_detect._clean_key("role: designer 岗位") == "designer"
    assert role_detect._clean_key("PM") == "pm"
    assert role_detect._clean_key("???无法识别") == role_detect.DEFAULT_ROLE
    print("OK: 岗位 key 归一化 + 兜底")


def test_detect_role_fallback_on_failure():
    # chat_fn 抛异常 -> 回退默认岗位，不抛
    def boom(_):
        raise RuntimeError("模型挂了")
    assert role_detect.detect_role("some text", boom) == role_detect.DEFAULT_ROLE
    assert role_detect.detect_role("", lambda m: "designer") == role_detect.DEFAULT_ROLE  # 空文本
    print("OK: 岗位检测失败/空文本回退")


# --------------------------- 极简夹具 --------------------------------------- #
class _Env:
    def __init__(self):
        import os
        self.os = os; self.saved = {}
    def set(self, k, v):
        self.saved.setdefault(k, self.os.environ.get(k))
        self.os.environ[k] = v
    def restore(self):
        for k, v in self.saved.items():
            if v is None:
                self.os.environ.pop(k, None)
            else:
                self.os.environ[k] = v


if __name__ == "__main__":
    import tempfile, os
    test_img_mime_sniff()
    env = _Env(); test_vision_no_key_raises(env.set); env.restore()
    # 造一个最小 PNG 临时文件
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
        tf.write(png); png_path = tf.name
    try:
        test_source_to_text_image_needs_ocr(png_path)
    finally:
        os.unlink(png_path)
    test_ocr_images_empty_result_fails()
    test_clean_key()
    test_detect_role_fallback_on_failure()
    print("\nALL PASS")
