"""The deterministic line printer of generated Python modules: a docstring, the imports as `import x as _x` sorted in
ruff's sections (standard library, third party, seampact, then the api's own modules as `from . import x as _x`),
then top-level blocks two blank lines apart. Output never
depends on the installed Python's `ast.unparse`; the golden files check it against `ruff format --check`."""

import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Final

LINE_LENGTH: Final = 120
INDENT: Final = "    "

_FIRST_PARTY: Final = "seampact"
_SIBLING_PREFIX: Final = "."
_SECTIONS: Final = 4
_DEFINITIONS: Final = ("class ", "def ", "@")


_DOUBLE_QUOTE: Final = '"'
_SINGLE_QUOTE: Final = "'"
_NAMED_ESCAPES: Final = {"\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
_LAST_PRINTABLE_ASCII: Final = 0x7E
_FIRST_PRINTABLE_ASCII: Final = 0x20
_LAST_BMP: Final = 0xFFFF
# Each piece of a long string ends after a space or a slash, where a part may end.
_BREAK_AFTER: Final = re.compile(r"[^ /]*[ /]|[^ /]+")


def string_literal(text: str) -> str:
    """A Python string literal of `text`, ASCII only, quoted as ruff quotes it: double quotes unless the text holds more
    double quotes than single ones; a character outside the Basic Multilingual Plane is one `\\U` escape."""
    quote = _SINGLE_QUOTE if text.count(_DOUBLE_QUOTE) > text.count(_SINGLE_QUOTE) else _DOUBLE_QUOTE

    return quote + "".join(_escaped(character, quote) for character in text) + quote


def _escaped(character: str, quote: str) -> str:
    if character == quote:
        return "\\" + character

    named = _NAMED_ESCAPES.get(character)

    if named is not None:
        return named

    code_point = ord(character)

    if _FIRST_PRINTABLE_ASCII <= code_point <= _LAST_PRINTABLE_ASCII:
        return character

    if code_point < _FIRST_PRINTABLE_ASCII or code_point == _LAST_PRINTABLE_ASCII + 1:
        return f"\\x{code_point:02x}"

    return f"\\u{code_point:04x}" if code_point <= _LAST_BMP else f"\\U{code_point:08x}"


def literal_lines(indent: str, head: str, value: object, tail: str) -> list[str]:
    """`head`, the Python literal of the JSON value `value`, then `tail`, at `indent`, as ruff formats it: a non-empty
    object or array one item per line with a trailing comma, which keeps it so, and a string too long for its line
    split at spaces into parenthesised parts."""
    if isinstance(value, dict):
        items = [
            line
            for key, item in value.items()
            for line in literal_lines(indent + INDENT, f"{string_literal(str(key))}: ", item, ",")
        ]

        return _bracketed_items(indent, head, "{", items, "}", tail)

    if isinstance(value, list | tuple):
        items = [line for item in value for line in literal_lines(indent + INDENT, "", item, ",")]

        return _bracketed_items(indent, head, "[", items, "]", tail)

    if isinstance(value, str):
        return _string_lines(indent, head, value, tail)

    return [f"{indent}{head}{_scalar_literal(value)}{tail}"]


def _bracketed_items(indent: str, head: str, opening: str, items: list[str], closing: str, tail: str) -> list[str]:
    if not items:
        return [f"{indent}{head}{opening}{closing}{tail}"]

    return [f"{indent}{head}{opening}", *items, f"{indent}{closing}{tail}"]


def _string_lines(indent: str, head: str, text: str, tail: str) -> list[str]:
    single = f"{indent}{head}{string_literal(text)}{tail}"

    if fits(single):
        return [single]

    parts = _string_parts(text, len(indent) + len(INDENT))

    return [f"{indent}{head}(", *(f"{indent}{INDENT}{string_literal(part)}" for part in parts), f"{indent}){tail}"]


def _string_parts(text: str, indent_width: int) -> list[str]:
    """`text` cut after spaces and slashes into parts whose literal fits a line at `indent_width`."""
    parts: list[str] = []
    current = ""

    for piece in _BREAK_AFTER.findall(text):
        if current and indent_width + len(string_literal(current + piece)) > LINE_LENGTH:
            parts.append(current)
            current = piece
        else:
            current += piece

    return [*parts, current]


def _scalar_literal(value: object) -> str:
    if value is None or isinstance(value, bool | int | float):
        return repr(value)

    raise TypeError(f"seampact-codegen: {type(value).__name__} is not a JSON value.")


@dataclass(slots=True)
class PythonModule:
    docstring: str
    _imports: dict[str, str] = field(default_factory=dict)
    _blocks: list[list[str]] = field(default_factory=list)

    def imported(self, module: str, alias: str) -> str:
        """Imports `module` under a private alias, so no framework name sits bare beside contract names (ADR 0026
        "Naming"); returns the alias. A module written `.name` is a sibling module of the api's package."""
        self._imports[module] = alias

        return alias

    def add_block(self, lines: Sequence[str]) -> None:
        self._blocks.append(list(lines))

    def text(self) -> str:
        sections = [
            [line for module, line in self._import_lines() if _section(module) == section]
            for section in range(_SECTIONS)
        ]
        parts = [f'"""{self.docstring}"""', *("\n".join(lines) for lines in sections if lines)]
        head = "\n\n".join(parts)
        body = "\n\n\n".join("\n".join(block) for block in self._blocks)

        if not body:
            return f"{head}\n"

        # ruff's import sorting leaves two blank lines before a class or function, one before a statement.
        separator = "\n\n\n" if body.startswith(_DEFINITIONS) else "\n\n"

        return f"{head}{separator}{body}\n"

    def _import_lines(self) -> list[tuple[str, str]]:
        return [(module, _import_line(module, self._imports[module])) for module in sorted(self._imports)]


def _import_line(module: str, alias: str) -> str:
    if module.startswith(_SIBLING_PREFIX):
        return f"from {_SIBLING_PREFIX} import {module.removeprefix(_SIBLING_PREFIX)} as {alias}"

    return f"import {module} as {alias}"


def _section(module: str) -> int:
    """ruff's import sections: the standard library, third party, seampact (first party), the api's own modules."""
    if module.startswith(_SIBLING_PREFIX):
        return 3

    top = module.split(".", 1)[0]

    if top == _FIRST_PARTY:
        return 2

    return 0 if top in sys.stdlib_module_names else 1


def fits(line: str) -> bool:
    return len(line) <= LINE_LENGTH
