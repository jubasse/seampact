"""A config value as JSON: what `json.loads` gives, and typed reads of its members that never guess."""

from collections.abc import Mapping, Sequence
from copy import deepcopy

type JsonValue = bool | int | float | str | list[JsonValue] | dict[str, JsonValue] | None
type JsonObject = dict[str, JsonValue]


def copy_of(value: JsonValue) -> JsonValue:
    return deepcopy(value)


def object_copy_of(value: JsonValue) -> JsonObject:
    """A copy of an object member; an empty object when it is absent or not an object."""
    return {key: copy_of(member) for key, member in value.items()} if isinstance(value, dict) else {}


def member(value: JsonValue, key: str) -> JsonValue:
    return value.get(key) if isinstance(value, dict) else None


def has(value: JsonValue, key: str) -> bool:
    return isinstance(value, dict) and key in value


def string_of(value: JsonValue, key: str) -> str | None:
    found = member(value, key)

    return found if isinstance(found, str) else None


def bool_of(value: JsonValue, key: str) -> bool | None:
    found = member(value, key)

    return found if isinstance(found, bool) else None


def object_of(value: JsonValue, key: str) -> JsonObject | None:
    found = member(value, key)

    return found if isinstance(found, dict) else None


def list_of(value: JsonValue, key: str) -> list[JsonValue] | None:
    found = member(value, key)

    return found if isinstance(found, list) else None


def strings_of(value: JsonValue, key: str) -> list[str] | None:
    """The member as a list of strings; None when it is absent or holds anything else."""
    found = list_of(value, key)

    if found is None or not all(isinstance(item, str) for item in found):
        return None

    return [item for item in found if isinstance(item, str)]


def as_mapping(value: JsonValue) -> Mapping[str, JsonValue]:
    return value if isinstance(value, dict) else {}


def as_sequence(value: JsonValue) -> Sequence[JsonValue]:
    return value if isinstance(value, list) else []
