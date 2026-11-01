"""The redacted rendering of a value that may carry a secret, so a logged or captured object never leaks it."""

import dataclasses
from collections.abc import Iterator
from typing import Any, ClassVar, Final

REDACTED: Final = "[redacted]"


class RedactedRepr:
    """A base for the frozen dataclasses holding a credential or raw bytes: `repr`, `str`, `pprint` and `rich` print
    `[redacted]` in place of each field named in `_REDACTED_FIELDS`. A subclass sets `repr=False` on its dataclass."""

    __slots__ = ()

    _REDACTED_FIELDS: ClassVar[frozenset[str]]
    # Set by the subclass's dataclass decorator.
    __dataclass_fields__: ClassVar[dict[str, dataclasses.Field[Any]]]

    def _rendered_fields(self) -> Iterator[tuple[str, object]]:
        for field in dataclasses.fields(self):
            value = getattr(self, field.name)

            yield field.name, _Redacted() if field.name in self._REDACTED_FIELDS else value

    def __repr__(self) -> str:
        rendered = ", ".join(f"{name}={value!r}" for name, value in self._rendered_fields())

        return f"{type(self).__qualname__}({rendered})"

    def __rich_repr__(self) -> Iterator[tuple[str, object]]:
        yield from self._rendered_fields()


class _Redacted:
    __slots__ = ()

    def __repr__(self) -> str:
        return REDACTED
