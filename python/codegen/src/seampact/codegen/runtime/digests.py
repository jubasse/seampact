"""The SHA-256 digests of the boundary (the throttle bucket key, and later the idempotency key and the strong ETag),
over the text `JSON.stringify` writes with object members sorted by name, so every target derives the same key from
the same values (ADR 0023 "Query and bounded values")."""

import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Final

# `JSON.stringify` writes an exponent from 1e21 up and below 1e-6.
_PLAIN_UPPER_EXPONENT: Final = 21
_PLAIN_LOWER_EXPONENT: Final = -6
# 2^53 - 1: an integer past it is written as the double JavaScript reads it as, so `str` would differ.
_MAX_SAFE_INTEGER: Final = 2**53 - 1
# 2^32 - 1, the first integer that is not an array index in JavaScript.
_NOT_AN_INDEX: Final = 4294967295
_INDEX_NAME: Final = re.compile(r"(?:0|[1-9][0-9]{0,9})")
_DECIMAL_TEXT: Final = re.compile(r"(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?")
_UTF16: Final = "utf-16-be"


def hex_of(parts: Sequence[object]) -> str:
    """The SHA-256 of the canonical JSON of `parts`, as lowercase hex."""
    return hashlib.sha256(canonical(list(parts)).encode("utf-8", errors="surrogatepass")).hexdigest()


def canonical(value: object) -> str:
    """`value` as `JSON.stringify` writes it, object members sorted by name. Raises `TypeError` for a value JSON
    cannot hold."""
    if value is None:
        return "null"

    if isinstance(value, bool):
        return "true" if value else "false"

    if isinstance(value, int):
        return str(value) if abs(value) <= _MAX_SAFE_INTEGER else _number(_as_double(value))

    if isinstance(value, float):
        return _number(value)

    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)

    if isinstance(value, Mapping):
        names = sorted((str(name) for name in value), key=_name_order)
        members = {str(name): member for name, member in value.items()}

        return (
            "{" + ",".join(f"{json.dumps(name, ensure_ascii=False)}:{canonical(members[name])}" for name in names) + "}"
        )

    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical(item) for item in value) + "]"

    raise TypeError(f"seampact: a digest cannot read a {type(value).__qualname__}.")


def _as_double(value: int) -> float:
    """The double JavaScript reads an integer literal as, infinite past the largest double, which it writes `null`."""
    try:
        return float(value)
    except OverflowError:
        return math.inf if value > 0 else -math.inf


def _name_order(name: str) -> tuple[int, bytes]:
    """Array-index names first in numeric order, as every JavaScript object orders its own keys, then the others by
    UTF-16 code units, as JavaScript's default sort compares them."""
    index = min(int(name), _NOT_AN_INDEX) if _INDEX_NAME.fullmatch(name) else _NOT_AN_INDEX

    return index, name.encode(_UTF16, errors="surrogatepass")


def _number(value: float) -> str:
    """A number as JavaScript prints its double: the shortest digits, plain between 1e-6 and 1e21, an exponent
    outside."""
    if not math.isfinite(value):
        return "null"

    if value == 0:
        return "0"

    parts = _DECIMAL_TEXT.fullmatch(repr(value))

    if parts is None:
        raise ValueError(f"seampact: the number {value!r} has no decimal form.")

    sign, integral, fraction, exponent_text = parts.group(1), parts.group(2), parts.group(3) or "", parts.group(4)
    digits = (integral + fraction).lstrip("0")
    leading_zeros = len(integral + fraction) - len(digits)
    exponent = int(exponent_text or "0") + len(integral) - 1 - leading_zeros
    digits = digits.rstrip("0")

    if exponent >= _PLAIN_UPPER_EXPONENT or exponent < _PLAIN_LOWER_EXPONENT:
        mantissa = digits if len(digits) == 1 else f"{digits[0]}.{digits[1:]}"

        return f"{sign}{mantissa}e{'-' if exponent < 0 else '+'}{abs(exponent)}"

    if exponent < 0:
        return f"{sign}0.{'0' * (-exponent - 1)}{digits}"

    whole = digits[: exponent + 1].ljust(exponent + 1, "0")
    decimals = digits[exponent + 1 :]

    return f"{sign}{whole}{'.' + decimals if decimals else ''}"
