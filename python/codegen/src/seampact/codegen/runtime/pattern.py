"""The framework-free pattern check: a contract pattern's normalised form (ADR 0003 section 9) translated for
Python's `re` and searched anywhere in the text, as JSON Schema reads `pattern`. The normalised form already spells
`.` and the shorthands as explicit classes, so the translation only maps `^` and `$` to the start and the end of the
string (`\\A`, `\\Z`, never before a final newline) and an astral escape `\\u{...}` to `\\U........`."""

import re
from dataclasses import dataclass, field
from functools import cache
from typing import Final

_ASTRAL_ESCAPE: Final = re.compile(r"u\{([0-9A-F]+)\}")
_ANCHORS: Final = {"^": r"\A", "$": r"\Z"}


@dataclass(frozen=True, slots=True)
class ContractPattern:
    normalized: str
    _compiled: re.Pattern[str] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "_compiled", re.compile(python_regex(self.normalized)))

    def matches(self, text: str) -> bool:
        return self._compiled.search(text) is not None


@cache
def contract_pattern(normalized: str) -> ContractPattern:
    """The compiled check of a normalised pattern, compiled once per process.

    Raises `re.error` for a text that is not a normalised pattern."""
    return ContractPattern(normalized)


def python_regex(normalized: str) -> str:
    """The `re` source of a normalised pattern."""
    translated: list[str] = []
    in_class = False
    index = 0

    while index < len(normalized):
        char = normalized[index]

        if char == "\\":
            escape, index = _escape(normalized, index + 1)
            translated.append(escape)
            continue

        if in_class:
            in_class = char != "]"
        elif char == "[":
            in_class = True
        else:
            char = _ANCHORS.get(char, char)

        translated.append(char)
        index += 1

    return "".join(translated)


def _escape(normalized: str, index: int) -> tuple[str, int]:
    """The escape starting after the backslash at `index - 1`, and the index after it."""
    astral = _ASTRAL_ESCAPE.match(normalized, index)

    if astral is not None:
        return f"\\U{int(astral.group(1), 16):08X}", astral.end()

    return "\\" + normalized[index : index + 1], index + 1
