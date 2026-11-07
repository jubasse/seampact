"""The value-rule validators of the generated serializers (ADR 0027 "Types and validation"). A refused value raises
DRF's `ValidationError` with the contract rule as its code. `pattern` runs the framework-free pattern check on the
IR's normalised pattern; length, bounds and `multipleOf` run the framework-free checks of ADR 0003."""

from collections.abc import Callable
from decimal import Decimal
from typing import Final

from rest_framework.exceptions import ValidationError

from seampact.codegen.runtime.pattern import contract_pattern
from seampact.codegen.runtime.value_rules import ValueRuleError, check_bounds, check_length, check_multiple_of

_PATTERN_RULE: Final = "pattern"

type Number = int | float | Decimal


def pattern(normalized: str) -> Callable[[str], None]:
    """The contract pattern, searched anywhere in the text as JSON Schema reads `pattern`."""
    compiled = contract_pattern(normalized)

    def check(value: str) -> None:
        if not compiled.matches(value):
            raise ValidationError("Does not match the contract pattern.", code=_PATTERN_RULE)

    return check


def length(min_length: int | None = None, max_length: int | None = None) -> Callable[[str | list[object]], None]:
    """`minLength` and `maxLength` under `rules: seampact-consistent`, counted in code points."""

    def check(value: str | list[object]) -> None:
        _checked(lambda: check_length(value, min_length, max_length))

    return check


def bounds(
    minimum: str | None = None,
    maximum: str | None = None,
    exclusive_minimum: str | None = None,
    exclusive_maximum: str | None = None,
) -> Callable[[Number], None]:
    """The bounds of ADR 0003, compared exactly as decimals."""

    def check(value: Number) -> None:
        _checked(lambda: check_bounds(value, minimum, maximum, exclusive_minimum, exclusive_maximum))

    return check


def multiple_of(divisor: str) -> Callable[[Number], None]:
    def check(value: Number) -> None:
        _checked(lambda: check_multiple_of(value, divisor))

    return check


def _checked(check: Callable[[], None]) -> None:
    try:
        check()
    except ValueRuleError as refused:
        raise ValidationError(refused.message, code=refused.rule) from None
