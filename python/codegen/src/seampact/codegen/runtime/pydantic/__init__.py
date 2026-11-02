"""The type layer of the generated Pydantic models FastAPI and Ninja share: annotated types whose `BeforeValidator`
turns a decoded wire value into the Python object Pydantic's strict mode expects (a whole-number float into an
`int`; `date-time`, `date`, `uuid` and decimal strings, and enum values, into their objects), and the validators of
`rules: seampact-consistent`, each failing with the contract rule's name as its Pydantic error type."""

from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Final, TypeVar
from uuid import UUID

from pydantic import AfterValidator, BeforeValidator
from pydantic_core import PydanticCustomError

from seampact.codegen.runtime import value_rules
from seampact.codegen.runtime.pattern import contract_pattern
from seampact.codegen.runtime.value_rules import ValueRuleError

_FORMAT_RULE: Final = "format"
_TYPE_RULE: Final = "type"


def whole_number(value: object) -> object:
    """A whole-number float in the safe range as an `int` (ADR 0003: `1.0` is an integer); `1.5`, `true` and `"1"`
    stay, for the strict type rule to refuse. An `int` outside the safe range is refused: it needs `int64`."""
    try:
        return value_rules.whole_number(value)
    except ValueRuleError as refused:
        raise _rule_error(refused.rule, refused.message) from None


def refuse_null(value: object) -> object:
    """A wire `null` on an optional member that is not nullable (ADR 0003 section 5: absent and null differ)."""
    if value is None:
        raise PydanticCustomError(_TYPE_RULE, "null on a member that is not nullable")

    return value


def date_time_from_wire(value: object) -> object:
    """An RFC 3339 date-time string as an aware `datetime`, kept with the offset it was sent with."""
    return _from_text(value, value_rules.date_time_from_text, "date-time")


def date_from_wire(value: object) -> object:
    return _from_text(value, value_rules.date_from_text, "date")


def uuid_from_wire(value: object) -> object:
    return _from_text(value, value_rules.uuid_from_text, "uuid")


def decimal_from_wire(value: object) -> object:
    return _from_text(value, value_rules.decimal_from_text, "decimal")


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
        _checked(lambda: value_rules.check_length(value, min_length, max_length))

        return value

    return AfterValidator(check)


def bounds(
    minimum: str | None = None,
    maximum: str | None = None,
    exclusive_minimum: str | None = None,
    exclusive_maximum: str | None = None,
) -> AfterValidator:
    """The bounds of ADR 0003, compared exactly as decimals; each bound is the IR's decimal literal."""

    def check[N: int | float | Decimal](value: N) -> N:
        _checked(lambda: value_rules.check_bounds(value, minimum, maximum, exclusive_minimum, exclusive_maximum))

        return value

    return AfterValidator(check)


def multiple_of(divisor: str) -> AfterValidator:
    def check[N: int | float | Decimal](value: N) -> N:
        _checked(lambda: value_rules.check_multiple_of(value, divisor))

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


def _from_text(value: object, convert: Callable[[str], object], format_: str) -> object:
    if not isinstance(value, str):
        return value

    try:
        return convert(value)
    except ValueRuleError:
        raise _format_error(format_) from None


def _checked(check: Callable[[], None]) -> None:
    try:
        check()
    except ValueRuleError as refused:
        raise _rule_error(refused.rule, refused.message) from None


def _format_error(format_: str) -> PydanticCustomError:
    return PydanticCustomError(_FORMAT_RULE, "not a {format}", {"format": format_})


def _rule_error(rule: str, message: str) -> PydanticCustomError:
    return PydanticCustomError(rule, message)
