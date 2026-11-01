"""The one JSON parse of the readers: the numbers and constants an IR may hold, nothing JavaScript would not read."""

import json
from collections.abc import Callable
from typing import Final

# An integer literal longer than this reads as a float, as other JSON parsers read one past 64 bits; it also keeps
# `int()` off a literal of thousands of digits.
_MAX_INTEGER_DIGITS: Final = 19


def parse_json_value(
    text: str, object_pairs_hook: Callable[[list[tuple[str, object]]], object] | None = None
) -> object:
    """The value of a JSON text; raises `ValueError` on a text that is not JSON, `NaN` and `Infinity` included.
    `object_pairs_hook` builds each object from its members in order."""
    return json.loads(
        text, parse_constant=_refuse_constant, parse_int=_parse_integer, object_pairs_hook=object_pairs_hook
    )


def _refuse_constant(constant: str) -> object:
    raise ValueError(f"{constant} is not a JSON value")


def _parse_integer(literal: str) -> int | float:
    digits = literal.removeprefix("-")

    return int(literal) if len(digits) <= _MAX_INTEGER_DIGITS else float(literal)
