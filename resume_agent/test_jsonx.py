"""jsonx 分级容错解析测试（离线）。"""

from jsonx import parse_json_lenient


def test_clean_object():
    assert parse_json_lenient('{"a": 1}', "object") == {"a": 1}
    print("OK: 合法对象原样通过")


def test_fenced():
    assert parse_json_lenient('```json\n{"a": 1}\n```', "object") == {"a": 1}
    assert parse_json_lenient('<think>想一下</think>\n[1,2,3]', "array") == [1, 2, 3]
    print("OK: 去围栏 / 去开头 think")


def test_leading_trailing_garbage():
    assert parse_json_lenient('好的，结果：{"a": 1} 以上。', "object") == {"a": 1}
    assert parse_json_lenient('这是数组 [1, 2] 完毕', "array") == [1, 2]
    print("OK: 忽略 JSON 前后杂物")


def test_trailing_comma():
    assert parse_json_lenient('{"a": 1, "b": 2,}', "object") == {"a": 1, "b": 2}
    assert parse_json_lenient('[1, 2, 3,]', "array") == [1, 2, 3]
    print("OK: 去尾逗号")


def test_truncated_object():
    # 截断：未闭合的字符串与括号被补齐
    out = parse_json_lenient('{"name": "张三", "work": [{"name": "A公司"', "object")
    assert out["name"] == "张三" and out["work"][0]["name"] == "A公司"
    print("OK: 截断补齐（补串+补括号）")


def test_nested_and_strings_with_braces():
    # 字符串内的 } 不应误判闭合
    out = parse_json_lenient('{"note": "含 } 和 ] 的文本", "n": 1}', "object")
    assert out["note"] == "含 } 和 ] 的文本" and out["n"] == 1
    print("OK: 字符串内括号不误判")


def test_reject_nan_inf():
    for bad in ('{"a": NaN}', '{"a": Infinity}'):
        try:
            parse_json_lenient(bad, "object")
            assert False
        except ValueError:
            pass
    print("OK: 拒绝 NaN/Infinity")


def test_root_type_mismatch():
    try:
        parse_json_lenient('[1,2]', "object")
        assert False
    except ValueError as e:
        assert "对象" in str(e)
    try:
        parse_json_lenient('{"a":1}', "array")
        assert False
    except ValueError as e:
        assert "数组" in str(e)
    print("OK: 根类型不符报错")


def test_empty_and_garbage():
    for bad in ("", "   ", "完全不是 JSON"):
        try:
            parse_json_lenient(bad, "object")
            assert False
        except ValueError:
            pass
    print("OK: 空/纯文本报错")


if __name__ == "__main__":
    test_clean_object()
    test_fenced()
    test_leading_trailing_garbage()
    test_trailing_comma()
    test_truncated_object()
    test_nested_and_strings_with_braces()
    test_reject_nan_inf()
    test_root_type_mismatch()
    test_empty_and_garbage()
    print("\nALL PASS")
