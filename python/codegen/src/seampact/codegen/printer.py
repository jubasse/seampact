"""The deterministic line printer of generated Python modules: a docstring, the imports as `import x as _x` sorted in
ruff's sections (standard library, third party, seampact), then top-level blocks two blank lines apart. Output never
depends on the installed Python's `ast.unparse`; the golden files check it against `ruff format --check`."""

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Final

LINE_LENGTH: Final = 120
INDENT: Final = "    "

_FIRST_PARTY: Final = "seampact"
_THIRD_PARTY: Final = frozenset({"pydantic"})
_DEFINITIONS: Final = ("class ", "def ", "@")


def string_literal(text: str) -> str:
    """A double-quoted Python string literal, ASCII only, as ruff writes quotes."""
    return json.dumps(text, ensure_ascii=True)


@dataclass(slots=True)
class PythonModule:
    docstring: str
    _imports: dict[str, str] = field(default_factory=dict)
    _blocks: list[list[str]] = field(default_factory=list)

    def imported(self, module: str, alias: str) -> str:
        """Imports `module` under a private alias, so no framework name sits bare beside contract names (ADR 0026
        "Naming"); returns the alias."""
        self._imports[module] = alias

        return alias

    def add_block(self, lines: Sequence[str]) -> None:
        self._blocks.append(list(lines))

    def text(self) -> str:
        sections = [
            [line for module, line in self._import_lines() if _section(module) == section] for section in range(3)
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
        return [(module, f"import {module} as {self._imports[module]}") for module in sorted(self._imports)]


def _section(module: str) -> int:
    top = module.split(".", 1)[0]

    if top == _FIRST_PARTY:
        return 2

    return 1 if top in _THIRD_PARTY else 0


def fits(line: str) -> bool:
    return len(line) <= LINE_LENGTH
