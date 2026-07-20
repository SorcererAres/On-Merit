"""app._check_layout 校验回归：非法类型/值 → BAD_LAYOUT（400），数值越界夹取，合法透传。

覆盖跨模型复核发现：templateId/themeColor 为数组/对象时 `in set` 曾抛 TypeError → 500，
契约要求任何非法布局值一律 400。离线，直接调函数，不起服务。
"""
import app
from app import ApiError


def _expect_bad(ls):
    try:
        app._check_layout(ls)
    except ApiError as e:
        assert e.code == "BAD_LAYOUT", f"{ls} 期望 BAD_LAYOUT，得 {e.code}"
        return
    raise AssertionError(f"{ls} 应被拒但通过了")


def test_non_str_template_and_color_rejected_as_400():
    # 非哈希类型（list/dict）与非法标量，都必须是 ApiError(BAD_LAYOUT)，绝不冒泡成 500
    for bad in [{"templateId": ["x"]}, {"templateId": 123}, {"templateId": None},
                {"themeColor": {"a": 1}}, {"themeColor": ["#fff"]}, {"themeColor": 42}]:
        _expect_bad(bad)


def test_unknown_enum_values_rejected():
    _expect_bad({"templateId": "fancy"})
    _expect_bad({"themeColor": "chartreuse"})       # 非预设且非 #RRGGBB
    _expect_bad({"themeColor": "#12"})              # 残缺 hex
    _expect_bad({"pageMode": "poster"})


def test_valid_passthrough_and_numeric_clamp():
    out = app._check_layout({"templateId": "modern", "themeColor": "#a1b2c3",
                             "fontScale": 9, "lineHeight": 0, "moduleSpacing": 99,
                             "pageMode": "single"})
    assert out["templateId"] == "modern"
    assert out["themeColor"] == "#a1b2c3"
    assert out["fontScale"] == 1.25          # 上夹
    assert out["lineHeight"] == 1.2          # 下夹
    assert out["moduleSpacing"] == 36        # 上夹
    assert out["pageMode"] == "single"
    # 非数值 fontScale 回落默认，而非崩溃
    out2 = app._check_layout({"fontScale": "big"})
    assert out2["fontScale"] == 1.0


def test_none_is_passthrough_none():
    assert app._check_layout(None) is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print(f"  ✓ {name}")
    print("layout 校验回归全过")
