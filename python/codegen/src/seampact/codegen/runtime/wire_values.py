"""The IR's wire form of path, query and header values (ADR 0003): each is text on the wire, read as the integer,
number or boolean its type names when the text spells one, and kept as text otherwise, so the type rule reports it.
The query is read from the raw query string with form decoding, never through a framework's parsed query."""

import re
from collections.abc import Mapping, Sequence
from typing import Final
from urllib.parse import unquote_plus, unquote_to_bytes

from seampact.codegen.runtime.ir_view import ir_map, ir_string

_INTEGER: Final = re.compile(r"-?(0|[1-9][0-9]*)")
_NUMBER: Final = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")
_TRUE: Final = "true"
_FALSE: Final = "false"


def decoded_segment(raw: str) -> str | None:
    """A raw path segment percent-decoded, or None when its bytes are not UTF-8."""
    try:
        return unquote_to_bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        return None


def path_value(raw: str, type_use: object) -> object:
    decoded = decoded_segment(raw)

    return raw if decoded is None else scalar(decoded, type_use)


def scalar(text: str, type_use: object) -> object:
    """The text of a parameter read as its scalar type names it, else the text itself."""
    scalar_type = ir_string(type_use, "type") if ir_string(type_use, "kind") == "scalar" else None

    if scalar_type == "integer" and _INTEGER.fullmatch(text):
        return int(text)

    if scalar_type == "number" and _NUMBER.fullmatch(text):
        return int(text) if _INTEGER.fullmatch(text) else float(text)

    if scalar_type == "boolean" and text in (_TRUE, _FALSE):
        return text == _TRUE

    return text


def raw_query(raw: str) -> dict[str, list[str]]:
    """Each query member by its form-decoded name, with all its raw values in order as received."""
    members: dict[str, list[str]] = {}

    for pair in raw.split("&"):
        if pair == "":
            continue

        name, _, value = pair.partition("=")
        members.setdefault(_form_decoded(name), []).append(value)

    return members


def list_items(values: Sequence[str], wire: object) -> list[str]:
    """A parameter's values form-decoded; a list written with `explode: false` is one comma-separated value, split
    on raw commas only, so an encoded `%2C` stays data within one item."""
    unexploded = ir_string(wire, "kind") == "list" and isinstance(wire, Mapping) and wire.get("explode") is False
    items: list[str] = []

    for value in values:
        items.extend(_form_decoded(item) for item in (value.split(",") if unexploded else [value]))

    return items


def query_value(values: Sequence[str], type_use: object) -> object:
    """An array parameter takes every value, a scalar one its only value; several values for a scalar stay a list,
    which the type rule refuses."""
    if ir_string(type_use, "kind") == "array":
        items = ir_map(type_use, "items")
        return [scalar(value, items) for value in values]

    return scalar(values[0], type_use) if len(values) == 1 else list(values)


def _form_decoded(text: str) -> str:
    """`+` is a space; bytes that are not UTF-8 keep the text as received, so the type rule reports it."""
    try:
        return unquote_plus(text, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        return text
