"""The YAML reader reads keys and numbers as the Node CLI's reader does (`yaml` core schema, keys as JavaScript object
keys): the expected values below are what that reader returns for each text."""

import pytest

from seampact.ir.config.json_value import JsonValue
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.config.yaml_reader import parse_config_text

_NAME = "seampact.config.yaml"


def _value_of(text: str) -> JsonValue:
    result = parse_config_text(text, _NAME)
    assert not isinstance(result, list), result

    return result.value


def _problems_of(text: str) -> list[ConfigProblem]:
    result = parse_config_text(text, _NAME)
    assert isinstance(result, list)

    return result


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("True: 1\n", {"true": 1}),
        ("TRUE: 1\n", {"true": 1}),
        ("false: 1\n", {"false": 1}),
        ("null: 1\n", {"": 1}),
        ("~: 1\n", {"": 1}),
        ("Null: 1\n", {"": 1}),
        ('"True": 1\n', {"True": 1}),
        ('"null": 1\n', {"null": 1}),
        ('1: a\n"1": b\n', {"1": "b"}),
        ("1e3: a\n", {"1000": "a"}),
        ("1.0: a\n", {"1": "a"}),
        ("12.: a\n", {"12": "a"}),
        ("-0: a\n", {"0": "a"}),
        ("1.5: a\n", {"1.5": "a"}),
        ("1e-7: a\n", {"1e-7": "a"}),
        ("1e21: a\n", {"1e+21": "a"}),
        ("0.000001: a\n", {"0.000001": "a"}),
        (".inf: a\n", {"Infinity": "a"}),
        ("0x10: a\n", {"16": "a"}),
    ],
)
def test_a_scalar_key_is_the_string_node_makes_of_its_value(text: str, expected: JsonValue) -> None:
    assert _value_of(text) == expected


@pytest.mark.parametrize("text", ["1.0: a\n1: b\n", "0x10: a\n16: b\n", "~: a\nnull: b\n", "False: a\nfalse: b\n"])
def test_two_keys_of_one_value_are_a_duplicate(text: str) -> None:
    assert [problem.code for problem in _problems_of(text)] == ["config.yaml.syntax"]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("k: 1e3\n", 1000),
        ("k: 1E3\n", 1000),
        ("k: 1.0\n", 1),
        ("k: 12.\n", 12),
        ("k: 2.5e1\n", 25),
        ("k: -0.0\n", 0),
        ("k: 1.5\n", 1.5),
        ("k: .5\n", 0.5),
    ],
)
def test_an_integral_float_is_an_integer_as_in_node(text: str, expected: JsonValue) -> None:
    value = _value_of(text)

    assert isinstance(value, dict)
    assert value["k"] == expected
    assert type(value["k"]) is type(expected)


def test_a_large_config_without_an_alias_is_read() -> None:
    value = _value_of("a: [" + ", ".join(["1"] * 120_000) + "]\n")

    assert isinstance(value, dict)
    items = value["a"]
    assert isinstance(items, list)
    assert len(items) == 120_000
