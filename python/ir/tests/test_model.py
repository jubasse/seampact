"""The generated model's reading rules (ADR 0010): unknowns kept or dropped, opaque presence, copies, integers."""

from types import MappingProxyType

import pytest

from seampact.ir.hydration import OMITTED, IrModelError, read_integer
from seampact.ir.model import (
    HttpMethod,
    HttpMethodUnknown,
    Param,
    PlainTextPart,
    TextPart,
    TextPartUnknown,
)

_PARAM = {"name": "page", "type": {"kind": "scalar", "type": "integer", "refinements": {}}, "required": False}


def test_an_unknown_member_is_dropped() -> None:
    part = TextPart.from_json({"kind": "text", "text": "hello", "addedLater": True})

    assert part == PlainTextPart(text="hello")
    assert part.to_json() == {"kind": "text", "text": "hello"}


def test_an_unknown_union_tag_is_kept_raw_and_written_back() -> None:
    raw = {"kind": "emoji", "name": "wave"}
    part = TextPart.from_json(raw)

    assert isinstance(part, TextPartUnknown)
    assert part.kind == "emoji"
    assert part.to_json() == raw


def test_an_unknown_case_cannot_carry_a_known_tag_or_another_tag() -> None:
    with pytest.raises(IrModelError, match="known one"):
        TextPartUnknown(kind="text", raw={"kind": "text"})

    with pytest.raises(IrModelError, match="does not carry"):
        TextPartUnknown(kind="emoji", raw={"kind": "other"})


def test_an_unknown_enum_value_is_kept() -> None:
    assert HttpMethodUnknown("BREW").to_json() == "BREW"

    with pytest.raises(IrModelError, match="known one"):
        HttpMethodUnknown(HttpMethod.GET.value)


def test_an_optional_opaque_member_keeps_null_apart_from_absent() -> None:
    assert Param.from_json(_PARAM).default is OMITTED
    assert Param.from_json({**_PARAM, "default": None}).default is None
    assert Param.from_json({**_PARAM, "default": None}).to_json()["default"] is None
    assert "default" not in Param.from_json(_PARAM).to_json()


def test_kept_values_are_frozen_copies() -> None:
    default = {"items": [1, 2]}
    param = Param.from_json({**_PARAM, "default": default})
    default["items"].append(3)

    assert param.default == MappingProxyType({"items": (1, 2)})
    assert param.to_json()["default"] == {"items": [1, 2]}

    unknown = TextPartUnknown(kind="emoji", raw=(raw := {"kind": "emoji"}))
    raw["kind"] = "changed"

    assert unknown.raw["kind"] == "emoji"


def test_a_missing_tag_names_the_union() -> None:
    with pytest.raises(IrModelError, match="TextPart: the tag member 'kind'"):
        TextPart.from_json({"text": "hello"})


@pytest.mark.parametrize(("value", "expected"), [(2, 2), (2.0, 2), (-(2**53 - 1), -(2**53 - 1))])
def test_an_ir_integer_reads(value: object, expected: int) -> None:
    assert read_integer(value, "at") == expected


@pytest.mark.parametrize("value", [2.5, True, "2", 2**53, float("inf")])
def test_a_value_that_is_not_an_ir_integer_is_refused(value: object) -> None:
    with pytest.raises(IrModelError):
        read_integer(value, "at")
