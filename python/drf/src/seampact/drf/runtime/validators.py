"""The value-rule validators of the generated serializers (ADR 0027 "Types and validation"). A refused value raises
DRF's `ValidationError` with the contract rule as its code. `pattern` runs the framework-free pattern check on the
IR's normalised pattern; the other rules come with the release that runs the DRF steps, and are refused by name until
then."""

from collections.abc import Callable
from decimal import Decimal
from typing import Final

from rest_framework.exceptions import ValidationError

from seampact.codegen.runtime.pattern import contract_pattern
from seampact.django.runtime import PlacementUnavailableError

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
    """`minLength` and `maxLength` under `rules: seampact-consistent`."""
    return _unavailable(f"The rule 'length({min_length}, {max_length})'")


def bounds(
    minimum: str | None = None,
    maximum: str | None = None,
    exclusive_minimum: str | None = None,
    exclusive_maximum: str | None = None,
) -> Callable[[Number], None]:
    """The bounds of ADR 0003, compared exactly as decimals."""
    return _unavailable(f"The bounds rule ({minimum}, {maximum}, {exclusive_minimum}, {exclusive_maximum})")


def multiple_of(divisor: str) -> Callable[[Number], None]:
    return _unavailable(f"The rule 'multipleOf {divisor}'")


def _unavailable[V](rule: str) -> Callable[[V], None]:
    def check(value: V) -> None:
        raise PlacementUnavailableError(f"{rule}, checking a {type(value).__name__},")

    return check
