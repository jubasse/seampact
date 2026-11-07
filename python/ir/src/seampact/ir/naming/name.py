"""A name as the IR stores it (ADR 0007 section 1): word segments, a role and, for `response`, a status."""

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

_SEGMENT: Final = re.compile(r"[a-z0-9]+")
_MIN_RESPONSE_STATUS: Final = 200
_MAX_RESPONSE_STATUS: Final = 399


class NameSource(StrEnum):
    """Where a written name comes from; it decides what a name without any segment means."""

    NAME = "name"
    ENUM_VALUE = "enumValue"
    RIGHT = "right"


class OperationIdCase(StrEnum):
    """The case of an operation id, `conventions.operationIds.case` (ADR 0002 section 13)."""

    CAMEL = "camel"
    SNAKE = "snake"


class NamingRole(StrEnum):
    """The roles of a name; the value is the role as written in the IR and in the vectors."""

    SCHEMA = "schema"
    INPUT = "input"
    OUTPUT = "output"
    QUERY = "query"
    HEADERS = "headers"
    PATH = "path"
    RESPONSE = "response"
    PARAMS = "params"
    ERROR = "error"
    ERRORS = "errors"
    PROPERTY = "property"
    ITEM = "item"
    VALUE = "value"
    VARIANT = "variant"
    ENDPOINTS = "endpoints"
    OPERATION = "operation"
    MEMBER = "member"
    ENUM_MEMBER = "enumMember"

    def is_type(self) -> bool:
        """Whether the identifier is a type, so that the shadowed type names apply to it."""
        return self not in (NamingRole.OPERATION, NamingRole.MEMBER, NamingRole.ENUM_MEMBER)

    def suffix_word(self) -> str | None:
        """The default word appended after the segments, `None` for none."""
        return self.value if self in _SUFFIXED_ROLES else None


_SUFFIXED_ROLES: Final = frozenset(
    {
        NamingRole.INPUT,
        NamingRole.OUTPUT,
        NamingRole.QUERY,
        NamingRole.HEADERS,
        NamingRole.PATH,
        NamingRole.RESPONSE,
        NamingRole.PARAMS,
        NamingRole.ERROR,
        NamingRole.ERRORS,
        NamingRole.ITEM,
        NamingRole.VALUE,
        NamingRole.ENDPOINTS,
    }
)


def assert_segments(segments: tuple[str, ...] | list[str]) -> None:
    """Raises `ValueError` for a segment outside `[a-z0-9]+`."""
    for segment in segments:
        if _SEGMENT.fullmatch(segment) is None:
            raise ValueError(f"a naming segment is [a-z0-9]+, got '{segment}'")


@dataclass(frozen=True, slots=True)
class IrName:
    """Raises `ValueError` for a segment outside `[a-z0-9]+`, or a status missing, out of range or on a role other
    than `response`."""

    segments: tuple[str, ...]
    role: NamingRole
    status: int | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "segments", tuple(self.segments))
        assert_segments(self.segments)

        if self.role is not NamingRole.RESPONSE:
            if self.status is not None:
                raise ValueError(f"role {self.role.value} has no status, got {self.status}")
            return

        if self.status is None or not _MIN_RESPONSE_STATUS <= self.status <= _MAX_RESPONSE_STATUS:
            shown = "none" if self.status is None else str(self.status)
            raise ValueError(
                f"a response status is an integer from {_MIN_RESPONSE_STATUS} to {_MAX_RESPONSE_STATUS}, got {shown}"
            )

    def words(self) -> tuple[str, ...]:
        """The segments, then the suffix words of the role (the status follows `response`)."""
        suffix = self.role.suffix_word()

        if suffix is None:
            return self.segments

        status = () if self.status is None else (str(self.status),)

        return (*self.segments, suffix, *status)


def operation_id(segments: tuple[str, ...] | list[str], case: OperationIdCase = OperationIdCase.CAMEL) -> str:
    """The string of an operation id: pure casing, with no reserved-word or digit escape, because the id is the
    same string in the IR, in OpenAPI and in `relays` (ADR 0007 section 3).

    Raises `ValueError` for no segment or a segment outside `[a-z0-9]+`.
    """
    if not segments:
        raise ValueError("an operation id needs at least one segment")

    assert_segments(segments)

    if case is OperationIdCase.SNAKE:
        return "_".join(segments)

    return segments[0] + "".join(segment.capitalize() for segment in segments[1:])
