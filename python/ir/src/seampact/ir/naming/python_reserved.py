"""The Python list of ADR 0007 section 5, read from the copy of `@seampact/spec`'s `reserved-words.json` this package
ships: the keywords escape in every role, the capitalised builtins in types, the other builtins and Pydantic's
`BaseModel` attributes in members and operations."""

import json
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from typing import Final

from seampact.ir.naming.name import NamingRole

_RESERVED_WORDS_FILE: Final = "reserved-words.json"
_PYTHON: Final = "python"
_MEMBER_ROLES: Final = frozenset({NamingRole.OPERATION, NamingRole.MEMBER})


@dataclass(frozen=True, slots=True)
class PythonReservedWords:
    keywords: frozenset[str]
    types: frozenset[str]
    members: frozenset[str]

    def reserves(self, identifier: str, role: NamingRole) -> bool:
        """Whether `identifier` collides with a keyword, or, by role, a shadowed name; compared case-sensitively."""
        if identifier in self.keywords:
            return True

        if role.is_type():
            return identifier in self.types

        return role in _MEMBER_ROLES and identifier in self.members


@cache
def python_reserved_words() -> PythonReservedWords:
    """Raises `ValueError` when the shipped copy has no well-formed Python list."""
    text = files("seampact.ir.naming").joinpath(_RESERVED_WORDS_FILE).read_text(encoding="utf-8")
    lists = json.loads(text).get("lists", {})
    python = lists.get(_PYTHON) if isinstance(lists, dict) else None

    if not isinstance(python, dict):
        raise ValueError(f"{_RESERVED_WORDS_FILE} has no '{_PYTHON}' list; copy it again from @seampact/spec")

    return PythonReservedWords(
        keywords=_words(python, "keywords"),
        types=_words(python, "types"),
        members=_words(python, "members"),
    )


def _words(python: dict[str, object], key: str) -> frozenset[str]:
    words = python.get(key)

    if not isinstance(words, list) or not all(isinstance(word, str) for word in words):
        raise ValueError(f"the '{_PYTHON}' list of {_RESERVED_WORDS_FILE} has no '{key}' list of strings")

    return frozenset(word for word in words if isinstance(word, str))
