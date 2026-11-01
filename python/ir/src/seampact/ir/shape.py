"""The shape of the IR the reader walks on the raw JSON to find an unknown must-act tag or value.

ADR 0005 section 3: a definition by name, a struct's walked members, a tagged union, an open enum, an array or a
map. A member that holds no definition is not listed. The generated `seampact.ir.model.shapes` holds the table.
"""

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class NamedShape:
    definition: str


@dataclass(frozen=True, slots=True)
class StructShape:
    members: Mapping[str, "Shape"]
    """The walked members, by JSON name."""


@dataclass(frozen=True, slots=True)
class UnionShape:
    tag: str
    must_act: bool
    variants: Mapping[str, str]
    """The definition of each tag value."""


@dataclass(frozen=True, slots=True)
class OpenEnumShape:
    known: tuple[str, ...]
    must_act: bool


@dataclass(frozen=True, slots=True)
class ItemsShape:
    of: "Shape"


@dataclass(frozen=True, slots=True)
class ValuesShape:
    of: "Shape"


type Shape = NamedShape | StructShape | UnionShape | OpenEnumShape | ItemsShape | ValuesShape
