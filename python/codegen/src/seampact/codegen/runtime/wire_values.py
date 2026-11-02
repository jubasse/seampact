"""The IR's wire form of path, query and header values (ADR 0003): each is text on the wire, read as the integer,
number or boolean its type names when the text spells one, and kept as text otherwise, so the type rule reports it.
The query is read from the raw query string with form decoding, never through a framework's parsed query."""

import math
import re
from collections.abc import Mapping, Sequence
from decimal import Decimal
from typing import Final
from urllib.parse import quote, unquote_plus, unquote_to_bytes

from seampact.codegen.runtime.ir_view import IrMap, ir_int, ir_map, ir_string
from seampact.codegen.runtime.uuid_text import UUID_TEXT
from seampact.codegen.runtime.wire_codec import scalar_to_wire

_INTEGER: Final = re.compile(r"-?(0|[1-9][0-9]*)")
_NUMBER: Final = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")
_TRUE: Final = "true"
_FALSE: Final = "false"
_PLACEHOLDER: Final = re.compile(r"\{([^{}]+)\}")
# `encodeURIComponent` keeps the unreserved set and `!*'()`.
_COMPONENT_SAFE: Final = "-_.!~*'()"
# RFC 3986's query characters beside the alphanumerics: what a kept query pair may hold unescaped in a `Link` target.
_QUERY_SAFE: Final = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/?")
_PATH_SAFE: Final = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~/")
_HEX_DIGITS: Final = frozenset(b"0123456789abcdefABCDEF")
_PERCENT: Final = ord("%")
# The raw query is text read from its bytes one to one (`RawTarget`), so a pair goes back to its bytes the same way.
_BYTES_AS_TEXT: Final = "latin-1"
# `Number#toString` writes plain digits while the decimal point sits at most 21 digits right and 6 zeros left.
_DECIMAL_DIGITS_MAX: Final = 21
_DECIMAL_ZEROS_MIN: Final = -6
_BOOLEAN: Final = (bool,)
_SCALAR_TYPES: Final = {"integer": (int,), "number": (int, float), "boolean": _BOOLEAN, "string": (str,)}


def scalar_issue(type_use: IrMap, value: object) -> str | None:
    """The rule a scalar breaks among its type, its `uuid` format and its length bounds, the check a scope id, a
    subject id and a rule's proof get before any hook reads them; None for a use of any other kind, which step 6 checks
    in full."""
    expected = _SCALAR_TYPES.get(ir_string(type_use, "type") or "")

    if expected is None:
        return None

    if isinstance(value, bool) and expected is not _BOOLEAN:
        return "type"

    if not isinstance(value, expected):
        return "type"

    if not isinstance(value, str):
        return None

    if ir_string(type_use, "format") == "uuid" and not UUID_TEXT.fullmatch(value):
        return "format"

    refinements = ir_map(type_use, "refinements")
    min_length = ir_int(refinements, "minLength")
    max_length = ir_int(refinements, "maxLength")

    if min_length is not None and len(value) < min_length:
        return "minLength"

    if max_length is not None and len(value) > max_length:
        return "maxLength"

    return None


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


def contract_path(template: str, values: Mapping[str, object]) -> str:
    """The contract path `template` with each `{wire name}` replaced by its value encoded as one segment, as the
    generated route helpers build a path.

    Raises `ValueError` for a value that cannot be one segment."""
    return _PLACEHOLDER.sub(
        lambda placeholder: path_segment(placeholder.group(1), values[placeholder.group(1)]), template
    )


def path_segment(name: str, value: object) -> str:
    """A path value as one segment, as the generated clients send it: its wire text, encoded as JavaScript's
    `encodeURIComponent` writes it.

    Raises `ValueError` for an empty, `.` or `..` text, which a URL parser reads as another route, or a value with no
    wire text."""
    text = _wire_text(name, value)

    if text in ("", ".", ".."):
        raise ValueError(
            f"The path parameter '{name}' must be one non-empty segment, not '{text}': it would reach another route."
        )

    return component_encoded(text)


def component_encoded(text: str) -> str:
    """`text` as JavaScript's `encodeURIComponent` writes it: every UTF-8 byte outside the unreserved set and `!*'()`
    percent-encoded."""
    return quote(text, safe=_COMPONENT_SAFE)


def kept_query_pairs(raw: str, names: Sequence[str]) -> list[str]:
    """The raw query's pairs whose form-decoded name is not one of `names`, in order, each made link safe."""
    return [
        link_safe(pair) for pair in raw.split("&") if pair != "" and _form_decoded(pair.partition("=")[0]) not in names
    ]


def link_safe(pair: str) -> str:
    """Bytes outside the RFC 3986 query set, and a `%` that starts no escape, percent-encoded, so a raw `>` or `"` the
    server accepted cannot break a `Link` target built from the pair."""
    return _escaped_outside(pair, _QUERY_SAFE)


def path_link_safe(request_path: str) -> str:
    """The request path with every byte but the unreserved ones and `/` percent-encoded, valid escapes kept, so a
    segment the server accepted adds no relation to a `Link` header or an absolute link built from it."""
    return _escaped_outside(request_path, _PATH_SAFE)


def _escaped_outside(text: str, safe_bytes: frozenset[int]) -> str:
    data = text.encode(_BYTES_AS_TEXT, errors="strict")
    safe: list[str] = []

    for index, byte in enumerate(data):
        starts_escape = byte == _PERCENT and _is_escape(data, index)
        kept = starts_escape or (byte != _PERCENT and byte in safe_bytes)
        safe.append(chr(byte) if kept else f"%{byte:02X}")

    return "".join(safe)


def _is_escape(data: bytes, index: int) -> bool:
    return index + 2 < len(data) and data[index + 1] in _HEX_DIGITS and data[index + 2] in _HEX_DIGITS


def _wire_text(name: str, value: object) -> str:
    if isinstance(value, bool):
        return _TRUE if value else _FALSE

    if isinstance(value, float):
        return _javascript_number(name, value)

    wire = scalar_to_wire(value)

    if not isinstance(wire, str | int):
        raise ValueError(f"The path parameter '{name}' has no wire text: {type(value).__qualname__}.")

    return str(wire)


def _javascript_number(name: str, value: float) -> str:
    """The text JavaScript's `String(value)` writes: plain digits from 1e-7 up to 1e21, an exponent outside."""
    if not math.isfinite(value):
        raise ValueError(f"The path parameter '{name}' must be a finite number, not {value}.")

    if value == 0:
        return "0"

    _sign, digit_tuple, exponent = Decimal(repr(abs(value))).normalize().as_tuple()
    digits = "".join(str(digit) for digit in digit_tuple)
    point = len(digits) + int(exponent)
    prefix = "-" if value < 0 else ""

    if len(digits) <= point <= _DECIMAL_DIGITS_MAX:
        return prefix + digits + "0" * (point - len(digits))

    if 0 < point <= _DECIMAL_DIGITS_MAX:
        return prefix + digits[:point] + "." + digits[point:]

    if _DECIMAL_ZEROS_MIN < point <= 0:
        return prefix + "0." + "0" * -point + digits

    mantissa = digits[0] + ("." + digits[1:] if len(digits) > 1 else "")

    return f"{prefix}{mantissa}e{'+' if point > 0 else '-'}{abs(point - 1)}"
