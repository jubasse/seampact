"""The wire form of path, query and header values, and the codec between a wire body and the generated values."""

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.wire_codec import PythonTree, WireCodec
from seampact.codegen.runtime.wire_values import list_items, path_value, query_value, raw_query, scalar
from seampact.hooks import Absent, Field

_INTEGER = {"kind": "scalar", "type": "integer"}
_NUMBER = {"kind": "scalar", "type": "number"}
_BOOLEAN: dict[str, IrJson] = {"kind": "scalar", "type": "boolean"}
_STRING: dict[str, IrJson] = {"kind": "scalar", "type": "string"}
_TASK: dict[str, IrJson] = {"kind": "ref", "schema": "Task"}


def _member(name: str, type_use: IrJson, *, optional: bool = False, nullable: bool = False) -> dict[str, IrJson]:
    return {"name": name, "type": type_use, "optional": optional, "nullable": nullable}


_IR_VIEW: dict[str, IrJson] = {
    "schemas": {
        "Task": {
            "kind": "object",
            "properties": [
                _member("id", {"kind": "scalar", "type": "string", "format": "uuid"}),
                _member("createdAt", {"kind": "scalar", "type": "string", "format": "date-time"}),
                _member("state", {"kind": "enum", "enum": "TaskState"}),
                _member("note", _STRING, optional=True, nullable=True),
                _member("owner", {"kind": "ref", "schema": "Owner"}, optional=True),
                _member("tags", {"kind": "array", "items": _STRING}),
                _member("payload", {"kind": "opaque"}, nullable=True),
            ],
        },
        "Owner": {"kind": "object", "properties": [_member("userId", _STRING)]},
    }
}
_MEMBERS = {
    "Task": {
        "id": "id",
        "createdAt": "created_at",
        "state": "state",
        "note": "note",
        "owner": "owner",
        "tags": "tags",
        "payload": "payload",
    },
    "Owner": {"userId": "user_id"},
}


class TaskState(StrEnum):
    OPEN = "open"


@dataclass(frozen=True)
class Owner:
    user_id: str


@dataclass(frozen=True)
class Task:
    id: UUID
    created_at: datetime
    state: TaskState
    tags: list[str]
    payload: object
    note: Field[str | None] = Absent.ABSENT
    owner: Owner | None = None


@pytest.fixture
def codec() -> WireCodec:
    return WireCodec(
        ApiContract(
            api="tasks", generated_by="0.0.0-dev", mount="", ir_view=_IR_VIEW, members=_MEMBERS, operation_members={}
        )
    )


@pytest.mark.parametrize(
    ("text", "type_use", "value"),
    [
        ("12", _INTEGER, 12),
        ("-0", _INTEGER, 0),
        ("012", _INTEGER, "012"),
        ("1.5", _INTEGER, "1.5"),
        ("1.5", _NUMBER, 1.5),
        ("2", _NUMBER, 2),
        ("1e3", _NUMBER, 1000.0),
        ("true", _BOOLEAN, True),
        ("True", _BOOLEAN, "True"),
        ("12", _STRING, "12"),
    ],
)
def test_a_parameter_text_reads_as_its_scalar_type_or_stays_text(text: str, type_use: object, value: object) -> None:
    assert scalar(text, type_use) == value
    assert type(scalar(text, type_use)) is type(value)


def test_a_path_segment_is_percent_decoded_and_non_utf8_bytes_stay_raw() -> None:
    assert path_value("caf%C3%A9", _STRING) == "café"
    assert path_value("%FF", _STRING) == "%FF"


def test_the_raw_query_keeps_every_value_in_order_with_form_decoding() -> None:
    members = raw_query("sort=a&a%20b=x+y&sort=b&&flag")

    assert members == {"sort": ["a", "b"], "a b": ["x+y"], "flag": [""]}
    assert list_items(members["a b"], None) == ["x y"]


def test_an_unexploded_list_splits_on_raw_commas_only() -> None:
    assert list_items(["a,b%2Cc"], {"kind": "list", "explode": False}) == ["a", "b,c"]
    assert list_items(["a,b"], {"kind": "list", "explode": True}) == ["a,b"]


def test_a_query_value_reads_by_its_type() -> None:
    assert query_value(["1", "2"], {"kind": "array", "items": _INTEGER}) == [1, 2]
    assert query_value(["3"], _INTEGER) == 3
    assert query_value(["3", "4"], _INTEGER) == ["3", "4"]


def test_a_wire_body_is_renamed_to_attributes_and_unknown_keys_are_reported(codec: WireCodec) -> None:
    tree = {
        "id": "x",
        "createdAt": "2026-01-02T03:04:05Z",
        "owner": {"userId": "u1", "user_id": "u2"},
        "tags": ["a"],
        "created_at": "shadow",
        "a/b~": 1,
    }

    assert codec.to_python(_TASK, tree) == PythonTree(
        {"id": "x", "created_at": "2026-01-02T03:04:05Z", "owner": {"user_id": "u1"}, "tags": ["a"]},
        ("/owner/user_id", "/created_at", "/a~1b~0"),
    )


def test_a_tree_of_the_wrong_type_is_left_for_the_type_rule(codec: WireCodec) -> None:
    assert codec.to_python(_TASK, ["not", "an", "object"]) == PythonTree(["not", "an", "object"])


def test_a_generated_value_encodes_with_wire_names_and_text_formats(codec: WireCodec) -> None:
    created_at = datetime(2026, 1, 2, 3, 4, 5, 120000, tzinfo=timezone(timedelta(hours=2)))
    task = Task(UUID(int=1), created_at, TaskState.OPEN, ["a"], {"k": [1.0]}, note=None, owner=Owner("u1"))

    assert codec.to_wire(_TASK, task) == {
        "id": "00000000-0000-0000-0000-000000000001",
        "createdAt": "2026-01-02T03:04:05.12+02:00",
        "state": "open",
        "note": None,
        "owner": {"userId": "u1"},
        "tags": ["a"],
        "payload": {"k": [1.0]},
    }


def test_an_absent_member_and_an_optional_none_are_left_out(codec: WireCodec) -> None:
    task = Task(UUID(int=1), datetime(2026, 1, 2, tzinfo=UTC), TaskState.OPEN, [], None)

    encoded = codec.to_wire(_TASK, task)

    assert isinstance(encoded, dict)
    assert "note" not in encoded
    assert "owner" not in encoded
    assert encoded["payload"] is None


def test_a_date_decimal_and_table_body_encode_as_text(codec: WireCodec) -> None:
    response = {"shape": "table", "body": {"kind": "scalar", "type": "string", "format": "date"}}

    assert codec.body_to_wire(response, {"a": date(2026, 1, 2)}) == {"a": "2026-01-02"}
    assert codec.to_wire({"kind": "scalar", "type": "string"}, Decimal("1.50")) == "1.50"


@pytest.mark.parametrize(
    ("value", "wire"),
    [
        (Decimal("0.0000001"), "0.0000001"),
        (Decimal("1e2"), "100"),
        (Decimal("0.01") * Decimal("0.00001"), "0.0000001"),
        (Decimal("-1.50"), "-1.50"),
    ],
)
def test_a_decimal_is_written_in_its_wire_form_without_an_exponent(codec: WireCodec, value: Decimal, wire: str) -> None:
    assert codec.to_wire({"kind": "scalar", "type": "string", "format": "decimal"}, value) == wire


@pytest.mark.parametrize(
    ("value", "wire"),
    [
        (datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC), "2026-01-02T03:04:05+00:00"),
        (datetime(2026, 1, 2, 3, 4, 5, 100, tzinfo=UTC), "2026-01-02T03:04:05.0001+00:00"),
        (datetime(2026, 1, 2, 3, 4, 5, 500000, tzinfo=timezone(timedelta(hours=-5))), "2026-01-02T03:04:05.5-05:00"),
        (datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone(timedelta(seconds=30))), "2026-01-02T03:03:35+00:00"),
    ],
)
def test_a_date_time_is_written_without_trailing_zeros_and_in_utc_for_a_sub_minute_offset(
    codec: WireCodec, value: datetime, wire: str
) -> None:
    assert codec.to_wire({"kind": "scalar", "type": "string", "format": "date-time"}, value) == wire


@pytest.mark.parametrize(
    ("type_use", "value", "message"),
    [
        ({"kind": "scalar", "type": "string"}, datetime(2026, 1, 2), "without an offset"),
        ({"kind": "opaque"}, None, "does not make nullable"),
        ({"kind": "scalar", "type": "string", "format": "decimal"}, Decimal("NaN"), "finite decimal"),
        (_TASK, Owner("u1"), "has the member 'id'"),
    ],
)
def test_a_value_the_contract_cannot_write_is_the_boundarys_failure(
    codec: WireCodec, type_use: dict[str, object], value: object, message: str
) -> None:
    with pytest.raises(BoundaryFailureError, match=message):
        codec.to_wire(type_use, value)


@pytest.mark.parametrize(
    ("shape", "body", "message"),
    [
        ("list", {"a": "x"}, "not a list"),
        ("page", "x", "not a list"),
        ("table", ["x"], "not a mapping"),
    ],
)
def test_a_body_that_is_not_its_shape_is_the_boundarys_failure(
    codec: WireCodec, shape: str, body: object, message: str
) -> None:
    with pytest.raises(BoundaryFailureError, match=message):
        codec.body_to_wire({"shape": shape, "body": _STRING}, body)


def test_an_array_value_that_is_not_a_list_is_the_boundarys_failure(codec: WireCodec) -> None:
    with pytest.raises(BoundaryFailureError, match="not a list"):
        codec.to_wire({"kind": "array", "items": _STRING}, "ab")
