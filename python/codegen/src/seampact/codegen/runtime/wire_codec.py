"""Turns a decoded wire body into the tree a generated model validates, and a generated value back into the wire
tree: object members renamed between their wire names and their Python attributes by the api's member table, unknown
keys taken out and reported by pointer (the input use's `unknownKeys` policy decides on them), and on the way out
`date-time` with its offset and the fraction it holds, `date`, `uuid`, decimals and enum members as wire text. Values
are read by attribute, so a Pydantic model and a frozen dataclass both encode."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Final
from uuid import UUID

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrMap, ir_map, ir_maps, ir_string, ir_true
from seampact.hooks import Absent

_LIST_SHAPES: Final = frozenset({"list", "page"})
_TABLE_SHAPE: Final = "table"
_OBJECT_SCHEMA: Final = "object"
_WHOLE_MINUTE: Final = timedelta(minutes=1)
_FRACTION_DIGITS: Final = 6


@dataclass(frozen=True, slots=True)
class PythonTree:
    """The tree a model validates; `unknown_keys` holds the wire pointer of each unknown member taken out."""

    value: object
    unknown_keys: tuple[str, ...] = field(default=())


class WireCodec:
    def __init__(self, contract: ApiContract) -> None:
        self._contract = contract

    def to_python(self, type_use: IrMap, tree: object) -> PythonTree:
        """Raises `LookupError` for a schema the api has no member table or object declaration for."""
        unknown: list[str] = []
        value = self._to_python(type_use, tree, "", unknown)

        return PythonTree(value, tuple(unknown))

    def to_wire(self, type_use: IrMap, value: object) -> object:
        """Raises `BoundaryFailureError` for a value the contract cannot write: null for a non-nullable opaque
        value, a date-time without an offset, or an object without a declared attribute."""
        if value is None or value is Absent.ABSENT:
            if ir_string(type_use, "kind") == "opaque" and not ir_true(type_use, "nullable"):
                raise BoundaryFailureError(
                    "seampact: the handler wrote null for an opaque value the contract does not make nullable; "
                    "return a JSON value, or declare it 'nullable: true'."
                )

            return None

        kind = ir_string(type_use, "kind")

        if kind == "ref":
            return self._object_to_wire(ir_string(type_use, "schema") or "", value)

        if kind == "array":
            return [self.to_wire(ir_map(type_use, "items"), item) for item in _items(value, "an array value")]

        if kind in ("scalar", "enum", "opaque"):
            return scalar_to_wire(value)

        raise LookupError(f"seampact: the type kind {kind!r} is not one the boundary encodes.")

    def body_to_wire(self, response: IrMap, body: object) -> object:
        """A response body as the wire writes it: a list's items, or a table's values keyed as the handler keyed
        them.

        Raises `BoundaryFailureError` for a list or page body that is not a list, or a table body that is not a
        mapping."""
        body_type = ir_map(response, "body")
        shape = ir_string(response, "shape")

        if shape in _LIST_SHAPES:
            return [self.to_wire(body_type, item) for item in _items(body, f"a {shape} body")]

        if shape == _TABLE_SHAPE:
            return {str(key): self.to_wire(body_type, item) for key, item in _entries(body).items()}

        return self.to_wire(body_type, body)

    def _to_python(self, type_use: IrMap, tree: object, pointer: str, unknown: list[str]) -> object:
        kind = ir_string(type_use, "kind")

        if kind == "ref" and isinstance(tree, dict):
            return self._object_to_python(ir_string(type_use, "schema") or "", tree, pointer, unknown)

        if kind == "array" and isinstance(tree, list):
            items = ir_map(type_use, "items")
            return [self._to_python(items, item, f"{pointer}/{index}", unknown) for index, item in enumerate(tree)]

        # A scalar, an enum or an opaque value, or a tree of the wrong type, which the model's type rule reports.
        return tree

    def _object_to_python(
        self, schema_id: str, tree: dict[str, object], pointer: str, unknown: list[str]
    ) -> dict[str, object]:
        attributes, properties = self._object_schema(schema_id)
        renamed: dict[str, object] = {}

        for wire_name, value in tree.items():
            attribute = attributes.get(wire_name)
            member_pointer = f"{pointer}/{_escaped(wire_name)}"

            if attribute is None:
                unknown.append(member_pointer)
                continue

            renamed[attribute] = self._to_python(ir_map(properties[wire_name], "type"), value, member_pointer, unknown)

        return renamed

    def _object_to_wire(self, schema_id: str, value: object) -> dict[str, object]:
        attributes, properties = self._object_schema(schema_id)
        encoded: dict[str, object] = {}

        for wire_name, attribute in attributes.items():
            if not hasattr(value, attribute):
                raise BoundaryFailureError(
                    f"seampact: a {type(value).__qualname__} was written for the schema '{schema_id}', which has the "
                    f"member '{attribute}'; return the generated type of the schema."
                )

            held = getattr(value, attribute)
            member = properties[wire_name]

            # An optional member that is not nullable holds None when absent; a nullable one holds `Field`.
            absent_none = held is None and ir_true(member, "optional") and not ir_true(member, "nullable")

            if held is Absent.ABSENT or absent_none:
                continue

            encoded[wire_name] = None if held is None else self.to_wire(ir_map(member, "type"), held)

        return encoded

    def _object_schema(self, schema_id: str) -> tuple[Mapping[str, str], dict[str, IrMap]]:
        schema = self._contract.declaration("schemas", schema_id)
        attributes = self._contract.members.get(schema_id)

        if ir_string(schema, "kind") != _OBJECT_SCHEMA or attributes is None:
            raise LookupError(f"seampact: no generated object type for the schema '{schema_id}'; regenerate the api.")

        properties = {ir_string(member, "name") or "": member for member in ir_maps(schema, "properties")}

        return attributes, properties


def scalar_to_wire(value: object) -> object:
    """A scalar, enum or opaque value as the wire writes it.

    Raises `BoundaryFailureError` for a date-time without an offset and a decimal that is not finite, which the
    contract cannot write."""
    if isinstance(value, Enum):
        return value.value

    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise BoundaryFailureError(
                "seampact: the handler wrote a date-time without an offset; give it a time zone, such as UTC."
            )

        return _date_time_text(value)

    if isinstance(value, date):
        return value.isoformat()

    if isinstance(value, Decimal):
        return _decimal_text(value)

    if isinstance(value, UUID):
        return str(value)

    return value


def _date_time_text(value: datetime) -> str:
    """RFC 3339 with the fraction the value holds, without trailing zeros (ADR 0003 section 8); an offset with
    seconds, which RFC 3339 cannot write, is written in UTC."""
    offset = value.utcoffset()

    if offset is not None and offset % _WHOLE_MINUTE:
        value = value.astimezone(UTC)

    if value.microsecond == 0:
        return value.isoformat(timespec="seconds")

    seconds, fraction_and_offset = value.isoformat(timespec="microseconds").split(".", 1)
    fraction = fraction_and_offset[:_FRACTION_DIGITS].rstrip("0")

    return f"{seconds}.{fraction}{fraction_and_offset[_FRACTION_DIGITS:]}"


def _decimal_text(value: Decimal) -> str:
    """ADR 0003's decimal wire form, never an exponent."""
    if not value.is_finite():
        raise BoundaryFailureError(f"seampact: the handler wrote the decimal {value}; write a finite decimal.")

    return format(value, "f")


def _items(value: object, held_as: str) -> Sequence[object]:
    if not isinstance(value, list | tuple):
        raise BoundaryFailureError(
            f"seampact: the handler wrote {held_as} as a {type(value).__qualname__}, not a list; return a list."
        )

    return value


def _entries(value: object) -> Mapping[object, object]:
    if not isinstance(value, Mapping):
        raise BoundaryFailureError(
            f"seampact: the handler wrote a table body as a {type(value).__qualname__}, not a mapping; return a "
            "mapping keyed as the contract keys it."
        )

    return value


def _escaped(key: str) -> str:
    """A JSON Pointer token (RFC 6901)."""
    return key.replace("~", "~0").replace("/", "~1")
