"""The deepest JSON nesting a reader reads, measured before any recursion.

Each array or object is one level, the root one is level 1 (the count of the Kotlin and PHP readers). The deepest
real IR is a few dozen levels. The parse, the checks and the hydration that follow recurse per level, so the whole
document is measured first, without recursion.
"""

import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from typing import Final

from seampact.ir.read.refusal import IrRefusal, IrRefusalCode, escape_pointer_segment, in_message

MAX_NESTING_DEPTH: Final = 256

# The characters that change the scan outside a string, and inside one; runs of any other are skipped whole.
_STRUCTURAL: Final = re.compile(r'[{}\[\],:"]')
_STRING_END_OR_ESCAPE: Final = re.compile(r'["\\]')
_SIMPLE_ESCAPES: Final = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}
_HEX_UNIT: Final = re.compile(r"[0-9A-Fa-f]{4}")
_REPLACEMENT_CHARACTER: Final = "�"


def check_text_nesting(text: str) -> IrRefusal | None:
    """The refusal of a JSON text nested past the bound, or `None`. One linear scan of the text, before it is parsed
    (`json.loads` gives no pointer): it counts the arrays and objects open outside strings and stops at the first one
    past the bound. It counts every array and object as written, a duplicate key's included, so a text too deep is
    refused even when it is also malformed; a shallow malformed text is left to the parser."""
    pointer = _TextNestingScan(text).first_pointer_past_bound()

    return None if pointer is None else _refusal(pointer)


def check_document_nesting(document: object) -> IrRefusal | None:
    """The same check on a document already parsed, by an explicit stack instead of recursion."""
    root = _children_of(document)

    if root is None:
        return None

    open_elements = [_OpenElement(root)]

    while open_elements:
        container = open_elements[-1]
        entry = next(container.children, None)

        if entry is None:
            open_elements.pop()
            continue

        container.segment, child = entry
        grandchildren = _children_of(child)

        if grandchildren is None:
            continue

        if len(open_elements) == MAX_NESTING_DEPTH:
            return _refusal("".join(f"/{escape_pointer_segment(element.segment)}" for element in open_elements))

        open_elements.append(_OpenElement(grandchildren))

    return None


def _refusal(pointer: str) -> IrRefusal:
    reached = MAX_NESTING_DEPTH + 1

    return IrRefusal(
        IrRefusalCode.NESTING_TOO_DEEP,
        pointer,
        str(reached),
        (str(MAX_NESTING_DEPTH),),
        None,
        f"The IR nests {reached} levels deep at {in_message(pointer)}, past the {MAX_NESTING_DEPTH} this reader "
        "reads: it refuses the whole document rather than overflow its stack.",
    )


@dataclass
class _OpenElement:
    """An open array or object of a parsed document: its children left to visit and the segment being visited."""

    children: Iterator[tuple[str, object]]
    segment: str = ""


def _children_of(element: object) -> Iterator[tuple[str, object]] | None:
    if isinstance(element, list | tuple):
        return ((str(index), child) for index, child in enumerate(element))

    if isinstance(element, Mapping):
        return ((str(key), child) for key, child in element.items())

    return None


@dataclass
class _OpenContainer:
    """An open array or object of a JSON text, with the member or index the scan is in."""

    is_object: bool
    key: str = ""
    index: int = 0

    def segment(self) -> str:
        return self.key if self.is_object else str(self.index)


class _TextNestingScan:
    def __init__(self, text: str) -> None:
        self._text = text
        self._open: list[_OpenContainer] = []
        self._position = 0
        # In an object, the next string is a key after `{` or `,`, and a value after `:`.
        self._expecting_key = False

    def first_pointer_past_bound(self) -> str | None:
        while True:
            found = _STRUCTURAL.search(self._text, self._position)

            if found is None:
                return None

            character = found.group()
            self._position = found.end()

            if character in "{[":
                if len(self._open) == MAX_NESTING_DEPTH:
                    return "".join(f"/{escape_pointer_segment(container.segment())}" for container in self._open)
                self._open.append(_OpenContainer(is_object=character == "{"))
                self._expecting_key = character == "{"
            elif character in "}]":
                if self._open:
                    self._open.pop()
                self._expecting_key = False
            elif character == ",":
                self._next_member()
            elif character == ":":
                self._expecting_key = False
            else:
                self._read_string()

    def _next_member(self) -> None:
        if not self._open:
            return

        container = self._open[-1]

        if container.is_object:
            self._expecting_key = True
        else:
            container.index += 1

    def _read_string(self) -> None:
        """Only a key is kept, decoded, for the pointer; any other string is skipped."""
        container = self._open[-1] if self._open else None
        is_key = self._expecting_key and container is not None and container.is_object
        self._expecting_key = False
        key: list[str] = []

        while True:
            found = _STRING_END_OR_ESCAPE.search(self._text, self._position)
            end = len(self._text) if found is None else found.start()

            if is_key:
                key.append(self._text[self._position : end])

            if found is None:
                self._position = end
                break

            self._position = found.end()

            if found.group() == '"':
                break

            escaped = self._read_escape(is_key)
            if is_key:
                key.append(escaped)

        if container is not None and is_key:
            container.key = "".join(key)

    def _read_escape(self, is_key: bool) -> str:
        """The decoded text of an escape, or '' when the string is not a key."""
        if self._position >= len(self._text):
            return ""

        escaped = self._text[self._position]
        self._position += 1

        if not is_key:
            return ""

        if escaped != "u":
            return _SIMPLE_ESCAPES.get(escaped, escaped)

        unit = self._read_hex_unit()

        if unit is None:
            return escaped

        if not 0xD800 <= unit <= 0xDFFF:
            return chr(unit)

        return self._read_surrogate_pair(unit)

    def _read_hex_unit(self) -> int | None:
        """Four hex digits make a \\u escape; anything else keeps the `u` as written, as the parser refuses it."""
        matched = _HEX_UNIT.match(self._text, self._position)

        if matched is None:
            return None

        self._position = matched.end()

        return int(matched.group(), 16)

    def _read_surrogate_pair(self, high: int) -> str:
        """A high surrogate followed by a \\u low surrogate is one code point; a lone surrogate is U+FFFD."""
        if high > 0xDBFF or not self._text.startswith("\\u", self._position):
            return _REPLACEMENT_CHARACTER

        saved = self._position
        self._position += 2
        low = self._read_hex_unit()

        if low is None or not 0xDC00 <= low <= 0xDFFF:
            self._position = saved
            return _REPLACEMENT_CHARACTER

        return chr(0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00))
