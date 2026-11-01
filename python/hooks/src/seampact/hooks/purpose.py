"""Why a requirement is checked: for the route, for one field, or for a sort key."""

from dataclasses import dataclass

from seampact.hooks.field_direction import FieldDirection


@dataclass(frozen=True, slots=True, kw_only=True)
class Route:
    pass


@dataclass(frozen=True, slots=True, kw_only=True)
class Field:
    """`pointer` is the JSON pointer of the field in the body."""

    pointer: str
    direction: FieldDirection


@dataclass(frozen=True, slots=True, kw_only=True)
class SortKey:
    key: str


type Purpose = Route | Field | SortKey
