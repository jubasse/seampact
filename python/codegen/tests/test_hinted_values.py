"""A generated frozen dataclass built from its hints: an enum member's wire text becomes the member, and a member typed
`Any` or by an alias keeps its value."""

import enum
import typing
from dataclasses import dataclass

from seampact.codegen.runtime.hinted_values import built_dataclass

type _Label = str


class _Role(enum.StrEnum):
    OWNER = "owner"


@dataclass(frozen=True, slots=True, kw_only=True)
class _Holder:
    roles: list[_Role]
    note: typing.Any
    label: _Label


def test_an_enum_text_becomes_its_member_and_an_any_or_alias_member_keeps_its_value() -> None:
    built = built_dataclass(_Holder, {"roles": ["owner"], "note": "x", "label": "y"})

    assert built == _Holder(roles=[_Role.OWNER], note="x", label="y")
    assert isinstance(built, _Holder)
    assert type(built.roles[0]) is _Role
