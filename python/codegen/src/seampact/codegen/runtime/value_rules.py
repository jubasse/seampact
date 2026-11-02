"""The framework-free type layer and value rules of ADR 0003: a decoded wire value checked against its scalar type and
turned into the Python object the handler reads (a whole-number float into an `int`; `date-time`, `date`, `uuid`
and decimal strings into their objects), and the length, bound and `multipleOf` rules of `rules:
seampact-consistent`. Each refusal raises `ValueRuleError` with the contract rule's name; a placement turns it into
its framework's error (Pydantic's, DRF's) or an issue of the boundary's `schemaInvalid`."""

import math
import re
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from typing import Final
from uuid import UUID

from seampact.codegen.runtime.ir_view import ir_int, ir_map, ir_string
from seampact.codegen.runtime.pattern import contract_pattern
from seampact.codegen.runtime.uuid_text import UUID_TEXT

MAX_SAFE_INTEGER: Final = 2**53 - 1
TYPE_RULE: Final = "type"
FORMAT_RULE: Final = "format"

_DATE_TIME: Final = re.compile(
    r"(\d{4}-\d{2}-\d{2})[Tt]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)"
    r"(?:\.(\d{1,9}))?([Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)",
    re.ASCII,
)
_DATE: Final = re.compile(r"\d{4}-\d{2}-\d{2}", re.ASCII)
_DECIMAL: Final = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?", re.ASCII)
_MICROSECOND_DIGITS: Final = 6


class ValueRuleError(ValueError):
    """A value the contract refuses; `rule` is the contract rule's name (`type`, `format`, `minLength`, ...)."""

    def __init__(self, rule: str, message: str) -> None:
        super().__init__(message)
        self.rule = rule
        self.message = message


def whole_number(value: object) -> object:
    """A whole-number float in the safe range as an `int` (ADR 0003: `1.0` is an integer); `1.5`, `true` and `"1"`
    stay, for the type rule to refuse. An `int` outside the safe range is refused: it needs `int64`."""
    if isinstance(value, float) and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
        return int(value)

    if isinstance(value, int) and not isinstance(value, bool) and abs(value) > MAX_SAFE_INTEGER:
        raise ValueRuleError(TYPE_RULE, "an integer outside the safe range")

    return value


def date_time_from_text(text: str) -> datetime:
    """An RFC 3339 date-time as an aware `datetime`, kept with the offset it was sent with."""
    matched = _DATE_TIME.fullmatch(text)

    if matched is None:
        raise _format_error("date-time")

    day, time, fraction, offset = matched.groups()
    microseconds = "" if fraction is None else "." + fraction[:_MICROSECOND_DIGITS].ljust(_MICROSECOND_DIGITS, "0")
    offset = "+00:00" if offset in ("Z", "z") else offset

    try:
        return datetime.fromisoformat(f"{day}T{time}{microseconds}{offset}")
    except ValueError:
        raise _format_error("date-time") from None


def date_from_text(text: str) -> date:
    try:
        if _DATE.fullmatch(text) is None:
            raise ValueError(text)

        return date.fromisoformat(text)
    except ValueError:
        raise _format_error("date") from None


def uuid_from_text(text: str) -> UUID:
    if UUID_TEXT.fullmatch(text) is None:
        raise _format_error("uuid")

    return UUID(text)


def decimal_from_text(text: str) -> Decimal:
    try:
        if _DECIMAL.fullmatch(text) is None:
            raise InvalidOperation(text)

        return Decimal(text)
    except InvalidOperation:
        raise _format_error("decimal") from None


_FORMATS: Final[dict[str, Callable[[str], object]]] = {
    "date-time": date_time_from_text,
    "date": date_from_text,
    "uuid": uuid_from_text,
    "decimal": decimal_from_text,
}


def scalar_from_wire(type_use: object, value: object) -> object:
    """A decoded value of a `scalar`, `enum` or `opaque` type use, checked by its type and converted by its format;
    an enum value stays its wire text, which the placement turns into its generated member. Raises
    `ValueRuleError`."""
    kind = ir_string(type_use, "kind")

    if kind == "enum":
        return _checked(value, isinstance(value, str))

    if kind != "scalar":
        return value

    scalar_type = ir_string(type_use, "type")

    if scalar_type == "integer":
        number = whole_number(value)
        return _checked(number, isinstance(number, int) and not isinstance(number, bool))

    if scalar_type == "number":
        finite = isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)
        return _checked(value, finite)

    if scalar_type == "boolean":
        return _checked(value, isinstance(value, bool))

    if not isinstance(value, str):
        raise ValueRuleError(TYPE_RULE, "not a string")

    convert = _FORMATS.get(ir_string(type_use, "format") or "")

    return value if convert is None else convert(value)


def checked_scalar(type_use: object, value: object) -> object:
    """`scalar_from_wire`, then every refinement of the type use with ADR 0003's meaning; a framework-free check for
    the values the boundary reads itself (a scope id, a subject id, a rule proof)."""
    converted = scalar_from_wire(type_use, value)
    refinements = ir_map(type_use, "refinements")

    if isinstance(converted, str):
        check_length(converted, ir_int(refinements, "minLength"), ir_int(refinements, "maxLength"))
        normalized = ir_string(ir_map(refinements, "pattern"), "normalized")

        if normalized is not None and not contract_pattern(normalized).matches(converted):
            raise ValueRuleError("pattern", "does not match the contract pattern")

    if isinstance(converted, int | float | Decimal) and not isinstance(converted, bool):
        check_bounds(
            converted,
            ir_string(refinements, "minimum"),
            ir_string(refinements, "maximum"),
            ir_string(refinements, "exclusiveMinimum"),
            ir_string(refinements, "exclusiveMaximum"),
        )
        divisor = ir_string(refinements, "multipleOf")

        if divisor is not None:
            check_multiple_of(converted, divisor)

    return converted


def check_length(value: str | list[object], min_length: int | None, max_length: int | None) -> None:
    """`minLength` and `maxLength`, counted in code points for a string."""
    if min_length is not None and len(value) < min_length:
        raise ValueRuleError("minLength", f"at least {min_length} long")

    if max_length is not None and len(value) > max_length:
        raise ValueRuleError("maxLength", f"at most {max_length} long")


def check_bounds(
    value: int | float | Decimal,
    minimum: str | None = None,
    maximum: str | None = None,
    exclusive_minimum: str | None = None,
    exclusive_maximum: str | None = None,
) -> None:
    """The bounds of ADR 0003, compared exactly as decimals; each bound is the IR's decimal literal."""
    exact = exact_decimal(value)
    rules: tuple[tuple[str, str | None, Callable[[Decimal, Decimal], bool]], ...] = (
        ("minimum", minimum, Decimal.__ge__),
        ("maximum", maximum, Decimal.__le__),
        ("exclusiveMinimum", exclusive_minimum, Decimal.__gt__),
        ("exclusiveMaximum", exclusive_maximum, Decimal.__lt__),
    )

    for rule, bound, holds in rules:
        if bound is not None and not holds(exact, Decimal(bound)):
            raise ValueRuleError(rule, f"outside the bound {bound}")


def check_multiple_of(value: int | float | Decimal, divisor: str) -> None:
    """Compared as exact fractions: a decimal remainder raises past the context's precision on a large value."""
    if Fraction(exact_decimal(value)) % Fraction(Decimal(divisor)) != 0:
        raise ValueRuleError("multipleOf", f"not a multiple of {divisor}")


def exact_decimal(value: int | float | Decimal) -> Decimal:
    """A float as the shortest decimal that reads back to it, the text the wire wrote, never its binary expansion."""
    return Decimal(repr(value)) if isinstance(value, float) else Decimal(value)


def _checked(value: object, holds: bool) -> object:
    if not holds:
        raise ValueRuleError(TYPE_RULE, "not a value of the contract's type")

    return value


def _format_error(format_: str) -> ValueRuleError:
    return ValueRuleError(FORMAT_RULE, f"not a {format_}")
