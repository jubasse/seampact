"""A number as JavaScript prints it (`String(value)`), which is how the Node CLI turns a number key of a YAML map into
an object key, and an integral float into the integer the Node reader hands to a generator."""

import math
from decimal import Decimal
from typing import Final

SAFE_INTEGER_MAX: Final = 2**53 - 1
_EXPONENT_FORM_ABOVE: Final = 21
_EXPONENT_FORM_BELOW: Final = -6


def integral_float_as_integer(value: float) -> int | float:
    """`value` as an integer when it is a finite whole number JavaScript holds exactly; else unchanged."""
    if math.isfinite(value) and value == math.floor(value) and abs(value) <= SAFE_INTEGER_MAX:
        return int(value)

    return value


def javascript_number_text(value: float) -> str:
    if math.isnan(value):
        return "NaN"

    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"

    if value == 0:
        return "0"

    sign = "-" if value < 0 else ""

    return sign + _positive_text(abs(value))


def _positive_text(value: float) -> str:
    _, digit_tuple, exponent = Decimal(repr(value)).normalize().as_tuple()
    assert isinstance(exponent, int)
    digits = "".join(str(digit) for digit in digit_tuple)
    # The value is 0.<digits> x 10^point.
    point = len(digits) + exponent

    if len(digits) <= point <= _EXPONENT_FORM_ABOVE:
        return digits + "0" * (point - len(digits))

    if 0 < point <= _EXPONENT_FORM_ABOVE:
        return f"{digits[:point]}.{digits[point:]}"

    if _EXPONENT_FORM_BELOW < point <= 0:
        return "0." + "0" * -point + digits

    mantissa = digits[0] + (f".{digits[1:]}" if len(digits) > 1 else "")
    shown_exponent = point - 1

    return f"{mantissa}e{'+' if shown_exponent > 0 else '-'}{abs(shown_exponent)}"
