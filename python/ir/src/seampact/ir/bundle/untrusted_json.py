"""A bundle's JSON comes from the network: refused when it is not UTF-8, starts with a byte order mark, nests past
the reader's bound or is not JSON, then when any key is a name that reaches a JavaScript prototype (every reader
refuses the same manifest), before a schema or a reader sees it."""

from dataclasses import dataclass
from typing import Final

from seampact.ir.bundle.text import pointer_below
from seampact.ir.https.untrusted_text import quoted
from seampact.ir.read.nesting import check_text_nesting
from seampact.ir.read.parse import parse_json_value

_RESERVED_KEYS: Final = frozenset({"__proto__", "constructor", "prototype"})
_BYTE_ORDER_MARK: Final = "﻿"


@dataclass(frozen=True, slots=True)
class ParsedJson:
    """`problem` is why the text is refused, as the end of a sentence naming the file; `document` is the value
    otherwise."""

    document: object
    problem: str | None


class _DuplicateKeyError(ValueError):
    def __init__(self, key: str) -> None:
        super().__init__(key)
        self.key = key


def parse_untrusted_json(data: bytes, *, refuse_duplicate_keys: bool) -> ParsedJson:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return _refused("is not UTF-8 text")

    if text.startswith(_BYTE_ORDER_MARK):
        return _refused("starts with a byte order mark (U+FEFF)")

    nesting = check_text_nesting(text)

    if nesting is not None:
        return _refused(f"is not readable: {nesting.message}")

    try:
        document = parse_json_value(text, _object_of if refuse_duplicate_keys else dict)
    except _DuplicateKeyError as error:
        return _refused(f"gives the key {quoted(error.key)} twice in one object")
    except (ValueError, RecursionError) as error:
        return _refused(f"is not JSON ({quoted(str(error))})")

    reserved_at = _reserved_key_pointer(document)

    if reserved_at is not None:
        return _refused(f"holds the reserved key at {quoted(reserved_at)}")

    return ParsedJson(document, None)


def _refused(problem: str) -> ParsedJson:
    return ParsedJson(None, problem)


def _object_of(pairs: list[tuple[str, object]]) -> dict[str, object]:
    members: dict[str, object] = {}

    for key, value in pairs:
        if key in members:
            raise _DuplicateKeyError(key)

        members[key] = value

    return members


def _reserved_key_pointer(root: object) -> str | None:
    """Iterative: the nesting bound holds, but a wide document is walked without recursion all the same."""
    pending: list[tuple[object, str]] = [(root, "")]

    while pending:
        value, pointer = pending.pop()

        if isinstance(value, dict):
            for key, member in value.items():
                at = pointer_below(pointer, key)

                if key in _RESERVED_KEYS:
                    return at

                pending.append((member, at))
        elif isinstance(value, list):
            pending.extend((member, pointer_below(pointer, str(index))) for index, member in enumerate(value))

    return None
