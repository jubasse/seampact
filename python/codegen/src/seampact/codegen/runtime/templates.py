"""Renders an IR template (ADR 0004 section 8) over its slots: the format's error body, a role's params and a
success envelope. A slot with no value renders as missing; an object member that renders as missing is left out, or
written as null when the format says `absent: null`."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.runtime.ir_view import IrMap, ir_list, ir_map, ir_maps, ir_string, ir_strings

_ITEM_SLOT: Final = "item"


@dataclass(frozen=True, slots=True)
class Rendered:
    present: bool
    value: object = None


_MISSING: Final = Rendered(False)


def render(template: object, slots: Mapping[str, object], write_nulls: bool) -> Rendered:
    """Raises `LookupError` for a template kind the boundary does not render."""
    kind = ir_string(template, "kind")

    if kind == "object":
        return _object(template if isinstance(template, Mapping) else {}, slots, write_nulls)

    if kind == "array":
        items = [render(item, slots, write_nulls) for item in ir_list(template, "items")]
        return Rendered(True, [item.value for item in items if item.present])

    if kind == "each":
        return _each(template, slots, write_nulls)

    if kind == "slot":
        return _slot(template, slots)

    if kind == "text":
        return _text(template, slots)

    if kind == "literal":
        return Rendered(True, template.get("value") if isinstance(template, Mapping) else None)

    raise LookupError(f"seampact: the template kind {kind!r} is not one the boundary renders.")


def _object(template: IrMap, slots: Mapping[str, object], write_nulls: bool) -> Rendered:
    rendered: dict[str, object] = {}

    for member in ir_maps(template, "members"):
        name = _member_name(ir_map(member, "name"), slots)

        if name is None:
            continue

        value = render(member.get("value"), slots, write_nulls)

        if value.present:
            rendered[name] = value.value
        elif write_nulls:
            rendered[name] = None

    merged = slots.get(ir_string(template, "merge") or "")

    if isinstance(merged, Mapping):
        rendered.update({str(key): value for key, value in merged.items()})

    return Rendered(True, rendered) if rendered else _MISSING


def _member_name(name: IrMap, slots: Mapping[str, object]) -> str | None:
    if ir_string(name, "kind") == "text":
        return ir_string(name, "text")

    value = slots.get(ir_string(name, "slot") or "")

    return str(value) if isinstance(value, str | int) and not isinstance(value, bool) else None


def _each(template: object, slots: Mapping[str, object], write_nulls: bool) -> Rendered:
    source = slots.get(ir_string(template, "of") or "")

    if not isinstance(source, list | tuple):
        return _MISSING

    items = [render(ir_map(template, "as"), {**slots, _ITEM_SLOT: item}, write_nulls) for item in source]

    return Rendered(True, [item.value for item in items if item.present])


def _text(template: object, slots: Mapping[str, object]) -> Rendered:
    text = ""

    for part in ir_maps(template, "parts"):
        if ir_string(part, "kind") == "text":
            text += ir_string(part, "text") or ""
            continue

        value = _slot(part, slots)

        if not value.present or not isinstance(value.value, str | int | float | bool):
            return _MISSING

        text += _scalar_text(value.value)

    return Rendered(True, text)


def _scalar_text(value: str | int | float | bool) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"

    return str(value)


def _slot(template: object, slots: Mapping[str, object]) -> Rendered:
    name = ir_string(template, "slot") or ""

    if name not in slots:
        return _MISSING

    value = slots[name]

    for key in ir_strings(template, "path"):
        if not isinstance(value, Mapping) or key not in value:
            return _MISSING

        value = value[key]

    return _MISSING if value is None else Rendered(True, value)
