"""A generated frozen dataclass built from a tree keyed by Python attribute whose scalars are already converted, each
member by its type hint: nested dataclasses, lists and mappings walked, and an enum member's wire text turned into the
member. A member already of its hinted type is kept, so a tree a serializer converted builds the same."""

import dataclasses
import typing
from collections.abc import Mapping, Sequence
from enum import Enum
from typing import TypeAliasType, get_args, get_origin, get_type_hints


def built_dataclass(cls: type, data: Mapping[str, object]) -> object:
    hints = get_type_hints(cls)
    values = {
        field.name: _converted(hints[field.name], data[field.name])
        for field in dataclasses.fields(cls)
        if field.name in data
    }

    return cls(**values)


def _converted(hint: object, value: object) -> object:
    if value is None:
        return None

    origin = get_origin(hint)

    if isinstance(origin, TypeAliasType) or isinstance(hint, TypeAliasType):
        arguments = get_args(hint)
        return _converted(arguments[0] if arguments else typing.Any, value)

    if origin in (list, Sequence) and isinstance(value, list):
        item = get_args(hint)[0]
        return [_converted(item, element) for element in value]

    if origin in (dict, Mapping) and isinstance(value, Mapping):
        item = get_args(hint)[1]
        return {key: _converted(item, element) for key, element in value.items()}

    for arm in get_args(hint) if origin in (typing.Union, type(int | None)) else (hint,):
        if isinstance(arm, type) and dataclasses.is_dataclass(arm) and isinstance(value, Mapping):
            return built_dataclass(arm, value)

        if isinstance(arm, type) and issubclass(arm, Enum) and isinstance(value, str) and not isinstance(value, arm):
            return arm(value)

    return value
