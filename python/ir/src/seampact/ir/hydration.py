"""The helpers the generated IR model reads and writes JSON with.

The model reads the output of `json.loads` (objects as `dict`) and writes back data `json.dumps` turns into the
same document. Every container the model keeps is a copy, frozen: arrays as tuples and objects as read-only
mappings, so the model never shares a value with its caller. Every message names the definition and member and
the JSON type found, never the value.
"""

import enum
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Protocol

type JsonValue = bool | int | float | str | list[JsonValue] | dict[str, JsonValue] | None
"""Data `json.dumps` writes: what `to_json` returns."""

type FrozenJson = bool | int | float | str | tuple[FrozenJson, ...] | Mapping[str, FrozenJson] | None
"""A JSON value the model keeps: an opaque value or an extension slot, frozen."""

# The largest IR integer, 2^53 - 1: IR integers are in the safe range of I-JSON (RFC 7493).
MAX_SAFE_INTEGER: Final = 9007199254740991


class IrModelError(ValueError):
    """The JSON does not have the shape of the IR model: the message names the definition and member."""


class Omitted(enum.Enum):
    """An optional opaque member the document does not have, apart from one that is JSON null."""

    OMITTED = "omitted"


OMITTED: Final = Omitted.OMITTED


@dataclass(frozen=True, slots=True)
class UnknownEnumValue:
    """A value of an open enum this IR revision does not know, kept raw."""

    raw: str

    def to_json(self) -> str:
        return self.raw


class UnknownVariant:
    """A variant of a tagged union this IR revision does not know: every union's `Unknown` class mixes it in."""

    __slots__ = ()


def json_type(value: object) -> str:
    """The JSON type of a decoded value, `bool` before `int` since a Python bool is an int."""
    if value is None:
        return "null"

    if isinstance(value, bool):
        return "boolean"

    if isinstance(value, int | float):
        return "number"

    if isinstance(value, str):
        return "string"

    if isinstance(value, list | tuple):
        return "array"

    return "object"


def read_object(value: object, at: str) -> Mapping[str, object]:
    if isinstance(value, Mapping):
        return value

    raise IrModelError(f"{at}: expected a JSON object, got the JSON type {json_type(value)}")


def read_string(value: object, at: str) -> str:
    if isinstance(value, str):
        return value

    raise IrModelError(f"{at}: expected a string, got the JSON type {json_type(value)}")


def read_boolean(value: object, at: str) -> bool:
    if isinstance(value, bool):
        return value

    raise IrModelError(f"{at}: expected a boolean, got the JSON type {json_type(value)}")


def read_integer(value: object, at: str) -> int:
    """An IR integer from -(2^53 - 1) to 2^53 - 1: a JSON integer, or a number with a zero fraction (`2.0`)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise IrModelError(f"{at}: expected an integer, got the JSON type {json_type(value)}")

    if isinstance(value, float) and not value.is_integer():
        raise IrModelError(f"{at}: expected an integer")

    if abs(value) > MAX_SAFE_INTEGER:
        raise IrModelError(f"{at}: expected an integer from -(2^53 - 1) to 2^53 - 1")

    return int(value)


def required[T](members: Mapping[str, object], name: str, at: str, read: Callable[[object], T]) -> T:
    if name not in members:
        raise IrModelError(f"{at}: the member '{name}' is missing")

    return read(members[name])


def optional[T](members: Mapping[str, object], name: str, read: Callable[[object], T]) -> T | None:
    """An optional member: absent and JSON null are both `None`."""
    value = members.get(name)

    return None if value is None else read(value)


def optional_opaque(members: Mapping[str, object], name: str, at: str) -> FrozenJson | Omitted:
    """An optional opaque member: absent is `OMITTED`, JSON null is `None`."""
    return freeze(members[name], at) if name in members else OMITTED


def union_tag(members: Mapping[str, object], name: str, at: str) -> str:
    """The tag of a union object: a string member, or an error naming the union."""
    tag = members.get(name)

    if not isinstance(tag, str):
        raise IrModelError(f"{at}: the tag member '{name}' is missing or not a string")

    return tag


def expect_tag(members: Mapping[str, object], name: str, expected: str, at: str) -> None:
    """A variant read on its own must carry its own tag."""
    if union_tag(members, name, at) != expected:
        raise IrModelError(f"{at}: the tag member '{name}' is not '{expected}'")


def read_list[T](value: object, at: str, read: Callable[[object], T]) -> tuple[T, ...]:
    if not isinstance(value, list | tuple):
        raise IrModelError(f"{at}: expected a JSON array, got the JSON type {json_type(value)}")

    return tuple(read(item) for item in value)


def read_map[T](value: object, at: str, read: Callable[[object], T]) -> Mapping[str, T]:
    members = read_object(value, at)

    return MappingProxyType({key: read(item) for key, item in members.items()})


def read_open_enum[E: enum.StrEnum, U](value: object, at: str, known: type[E], unknown: Callable[[str], U]) -> E | U:
    """A known value as its enum member, any other string kept as `unknown(raw)`."""
    raw = read_string(value, at)

    try:
        return known(raw)
    except ValueError:
        return unknown(raw)


def freeze(value: object, at: str) -> FrozenJson:
    """A frozen deep copy of decoded JSON, refusing a value JSON cannot hold."""
    if value is None or isinstance(value, bool | int | str):
        return value

    if isinstance(value, float):
        if not math.isfinite(value):
            raise IrModelError(f"{at}: expected a finite number, got {value}")

        return value

    if isinstance(value, list | tuple):
        return tuple(freeze(item, f"{at}[]") for item in value)

    if isinstance(value, Mapping):
        return freeze_object(value, at)

    raise IrModelError(f"{at}: expected a JSON value, got the Python type {type(value).__name__}")


def freeze_object(value: object, at: str) -> Mapping[str, FrozenJson]:
    members = read_object(value, at)

    for key in members:
        if not isinstance(key, str):
            raise IrModelError(f"{at}: expected string keys, got the Python type {type(key).__name__}")

    return MappingProxyType({key: freeze(item, f"{at}{{}}") for key, item in members.items()})


def freeze_extensions(value: object, at: str) -> Mapping[str, Mapping[str, FrozenJson]]:
    """An extension slot: an object of objects of opaque values (ADR 0004 section 3)."""
    prefixes = read_object(value, at)

    return MappingProxyType({key: freeze_object(item, f"{at}{{}}") for key, item in prefixes.items()})


def string_reader(at: str) -> Callable[[object], str]:
    return lambda value: read_string(value, at)


def integer_reader(at: str) -> Callable[[object], int]:
    return lambda value: read_integer(value, at)


def boolean_reader(at: str) -> Callable[[object], bool]:
    return lambda value: read_boolean(value, at)


def opaque_reader(at: str) -> Callable[[object], FrozenJson]:
    return lambda value: freeze(value, at)


def extensions_reader(at: str) -> Callable[[object], Mapping[str, Mapping[str, FrozenJson]]]:
    return lambda value: freeze_extensions(value, at)


def list_reader[T](at: str, read: Callable[[object], T]) -> Callable[[object], tuple[T, ...]]:
    return lambda value: read_list(value, at, read)


def map_reader[T](at: str, read: Callable[[object], T]) -> Callable[[object], Mapping[str, T]]:
    return lambda value: read_map(value, at, read)


def open_enum_reader[E: enum.StrEnum, U](
    at: str, known: type[E], unknown: Callable[[str], U]
) -> Callable[[object], E | U]:
    return lambda value: read_open_enum(value, at, known, unknown)


def copy_list[T](items: tuple[T, ...] | list[T]) -> tuple[T, ...]:
    return tuple(items)


def copy_map[T](items: Mapping[str, T]) -> Mapping[str, T]:
    return MappingProxyType(dict(items))


def thaw(value: FrozenJson) -> JsonValue:
    """Kept JSON back as data `json.dumps` writes; a fresh copy each time."""
    if isinstance(value, tuple):
        return [thaw(item) for item in value]

    if isinstance(value, Mapping):
        return thaw_object(value)

    return value


def thaw_object(value: Mapping[str, FrozenJson]) -> dict[str, JsonValue]:
    return {key: thaw(item) for key, item in value.items()}


def thaw_extensions(value: Mapping[str, Mapping[str, FrozenJson]]) -> dict[str, JsonValue]:
    return {key: thaw_object(item) for key, item in value.items()}


class JsonEncodable(Protocol):
    def to_json(self) -> JsonValue: ...


def encode_model(value: JsonEncodable) -> JsonValue:
    return value.to_json()


def encode_plain(value: JsonValue) -> JsonValue:
    return value


def list_encoder[T](encode: Callable[[T], JsonValue]) -> Callable[[tuple[T, ...]], JsonValue]:
    return lambda items: encode_list(items, encode)


def map_encoder[T](encode: Callable[[T], JsonValue]) -> Callable[[Mapping[str, T]], JsonValue]:
    return lambda items: encode_map(items, encode)


def encode_list[T](items: tuple[T, ...], encode: Callable[[T], JsonValue]) -> list[JsonValue]:
    return [encode(item) for item in items]


def encode_map[T](items: Mapping[str, T], encode: Callable[[T], JsonValue]) -> dict[str, JsonValue]:
    return {key: encode(item) for key, item in items.items()}


def encode_open_enum(value: enum.StrEnum | UnknownEnumValue) -> str:
    return value.to_json() if isinstance(value, UnknownEnumValue) else value.value
