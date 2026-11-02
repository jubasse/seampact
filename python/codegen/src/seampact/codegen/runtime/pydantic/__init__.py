"""The type layer of the generated Pydantic models FastAPI and Ninja share: annotated types whose `BeforeValidator`
turns a decoded wire value into the Python object Pydantic's strict mode expects (a whole-number float into an
`int`; `date-time`, `date`, `uuid` and decimal strings, and enum values, into their objects), and the validators of
`rules: seampact-consistent`, each failing with the contract rule's name as its Pydantic error type."""

import re
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Annotated, Final, TypeVar
from uuid import UUID

from pydantic import AfterValidator, BeforeValidator
from pydantic_core import PydanticCustomError

from seampact.codegen.runtime.pattern import contract_pattern
from seampact.codegen.runtime.uuid_text import UUID_TEXT

MAX_SAFE_INTEGER: Final = 2**53 - 1

_DATE_TIME: Final = re.compile(
    r"(\d{4}-\d{2}-\d{2})[Tt]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)"
    r"(?:\.(\d{1,9}))?([Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)",
    re.ASCII,
)
_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}", re.ASCII)
_DECIMAL: Final = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?", re.ASCII)
_MICROSECOND_DIGITS: Final = 6
_FORMAT_RULE: Final = "format"
_TYPE_RULE: Final = "type"


def whole_number(value: object) -> object:
    """A whole-number float in the safe range as an `int` (ADR 0003: `1.0` is an integer); `1.5`, `true` and `"1"`
    stay, for the strict type rule to refuse. An `int` outside the safe range is refused: it needs `int64`."""
    if isinstance(value, float) and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
        return int(value)

    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > MAX_SAFE_INTEGER:
        raise PydanticCustomError(_TYPE_RULE, "an integer outside the safe range")

    return value


def refuse_null(value: object) -> object:
    """A wire `null` on an optional member that is not nullable (ADR 0003 section 5: absent and null differ)."""
    if value is None:
        raise PydanticCustomError(_TYPE_RULE, "null on a member that is not nullable")

    return value


def date_time_from_wire(value: object) -> object:
    """An RFC 3339 date-time string as an aware `datetime`, kept with the offset it was sent with."""
    if not isinstance(value, str):
        return value

    matched = _DATE_TIME.fullmatch(value)

    if matched is None:
        raise _format_error("date-time")

    day, time, fraction, offset = matched.groups()
    microseconds = "" if fraction is None else "." + fraction[:_MICROSECOND_DIGITS].ljust(_MICROSECOND_DIGITS, "0")
    offset = "+00:00" if offset in ("Z", "z") else offset

    try:
        return datetime.fromisoformat(f"{day}T{time}{microseconds}{offset}")
    except ValueError:
        raise _format_error("date-time") from None


def date_from_wire(value: object) -> object:
    if not isinstance(value, str):
        return value

    try:
        if _DATE.fullmatch(value) is None:
            raise ValueError(value)

        return date.fromisoformat(value)
    except ValueError:
        raise _format_error("date") from None


def uuid_from_wire(value: object) -> object:
    if not isinstance(value, str):
        return value

    if UUID_TEXT.fullmatch(value) is None:
        raise _format_error("uuid")

    return UUID(value)


def decimal_from_wire(value: object) -> object:
    if not isinstance(value, str):
        return value

    try:
        if _DECIMAL.fullmatch(value) is None:
            raise InvalidOperation(value)

        return Decimal(value)
    except InvalidOperation:
        raise _format_error("decimal") from None


def enum_from_wire[E: Enum](enum_type: type[E]) -> BeforeValidator:
    """A string that is one of the enum's values as its member; any other value stays, for the strict enum rule."""

    def member(value: object) -> object:
        if not isinstance(value, str):
            return value

        return next((item for item in enum_type if item.value == value), value)

    return BeforeValidator(member)


WholeNumber = Annotated[int, BeforeValidator(whole_number)]
WireDateTime = Annotated[datetime, BeforeValidator(date_time_from_wire)]
WireDate = Annotated[date, BeforeValidator(date_from_wire)]
WireUuid = Annotated[UUID, BeforeValidator(uuid_from_wire)]
WireDecimal = Annotated[Decimal, BeforeValidator(decimal_from_wire)]

_T = TypeVar("_T")

# An optional member that is not nullable: absent, it takes the default None, which Pydantic does not validate; a
# wire `null` meets `refuse_null` (ADR 0003 section 5: absent and null differ). A generic `Annotated` alias, not a
# `type` statement: Pydantic 2.9, FastAPI 0.162's floor, builds no schema from a subscripted PEP 695 alias.
Omittable = Annotated[_T | None, BeforeValidator(refuse_null)]


def length(min_length: int | None = None, max_length: int | None = None) -> AfterValidator:
    """`minLength` and `maxLength` of a string or a list, counted in code points for a string."""

    def check[V: str | list[object]](value: V) -> V:
        if min_length is not None and len(value) < min_length:
            raise _rule_error("minLength", f"at least {min_length} long")

        if max_length is not None and len(value) > max_length:
            raise _rule_error("maxLength", f"at most {max_length} long")

        return value

    return AfterValidator(check)


def bounds(
    minimum: str | None = None,
    maximum: str | None = None,
    exclusive_minimum: str | None = None,
    exclusive_maximum: str | None = None,
) -> AfterValidator:
    """The bounds of ADR 0003, compared exactly as decimals; each bound is the IR's decimal literal."""
    rules: list[tuple[str, Decimal, Callable[[Decimal, Decimal], bool]]] = [
        (rule, Decimal(bound), holds)
        for rule, bound, holds in (
            ("minimum", minimum, Decimal.__ge__),
            ("maximum", maximum, Decimal.__le__),
            ("exclusiveMinimum", exclusive_minimum, Decimal.__gt__),
            ("exclusiveMaximum", exclusive_maximum, Decimal.__lt__),
        )
        if bound is not None
    ]

    def check[N: int | float | Decimal](value: N) -> N:
        exact = _exact(value)

        for rule, bound, holds in rules:
            if not holds(exact, bound):
                raise _rule_error(rule, f"outside the bound {bound}")

        return value

    return AfterValidator(check)


def multiple_of(divisor: str) -> AfterValidator:
    exact_divisor = Decimal(divisor)

    def check[N: int | float | Decimal](value: N) -> N:
        if _exact(value) % exact_divisor != 0:
            raise _rule_error("multipleOf", f"not a multiple of {divisor}")

        return value

    return AfterValidator(check)


def pattern(normalized: str) -> AfterValidator:
    """The contract pattern, checked by the framework-free pattern check on Python's `re`."""
    compiled = contract_pattern(normalized)

    def check(value: str) -> str:
        if not compiled.matches(value):
            raise _rule_error("pattern", "does not match the contract pattern")

        return value

    return AfterValidator(check)


def _exact(value: int | float | Decimal) -> Decimal:
    """A float as the shortest decimal that reads back to it, the text the wire wrote, never its binary expansion."""
    return Decimal(repr(value)) if isinstance(value, float) else Decimal(value)


def _format_error(format_: str) -> PydanticCustomError:
    return PydanticCustomError(_FORMAT_RULE, "not a {format}", {"format": format_})


def _rule_error(rule: str, message: str) -> PydanticCustomError:
    return PydanticCustomError(rule, message)
