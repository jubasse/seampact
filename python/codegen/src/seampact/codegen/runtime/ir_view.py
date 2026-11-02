"""Typed reads of the IR view the generated code holds as JSON values: a missing or mistyped member reads as an
empty map or list, or None, so the boundary never indexes past a member the contract does not carry."""

from collections.abc import Mapping, Sequence

type IrMap = Mapping[str, object]
type IrJson = bool | int | float | str | list[IrJson] | dict[str, IrJson] | None
"""A JSON value as the generated code writes it, so a type checker reads each empty object or array it holds."""

_EMPTY: IrMap = {}


def ir_map(node: object, key: str) -> IrMap:
    value = node.get(key) if isinstance(node, Mapping) else None

    return value if isinstance(value, Mapping) else _EMPTY


def ir_list(node: object, key: str) -> Sequence[object]:
    value = node.get(key) if isinstance(node, Mapping) else None

    return value if isinstance(value, list | tuple) else ()


def ir_maps(node: object, key: str) -> list[IrMap]:
    """Each member of the list that is a map."""
    return [item for item in ir_list(node, key) if isinstance(item, Mapping)]


def ir_string(node: object, key: str) -> str | None:
    value = node.get(key) if isinstance(node, Mapping) else None

    return value if isinstance(value, str) else None


def ir_strings(node: object, key: str) -> list[str]:
    return [item for item in ir_list(node, key) if isinstance(item, str)]


def ir_int(node: object, key: str) -> int | None:
    value = node.get(key) if isinstance(node, Mapping) else None

    return value if isinstance(value, int) and not isinstance(value, bool) else None


def ir_true(node: object, key: str) -> bool:
    return isinstance(node, Mapping) and node.get(key) is True
