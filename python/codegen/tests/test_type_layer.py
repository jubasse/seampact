"""The type layer of the generated Pydantic models (`seampact.codegen.runtime.pydantic`), alone and through the
reference golden models."""

import importlib.util
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from enum import StrEnum
from pathlib import Path
from types import ModuleType
from typing import Annotated
from uuid import UUID

import pydantic
import pytest
from typing_extensions import TypeForm

import seampact.codegen.runtime.pydantic as type_layer
from seampact.codegen.runtime.value_rules import ValueRuleError, check_bounds, check_multiple_of

_GOLDEN = Path(__file__).parent / "golden" / "reference"


def _golden_schemas(package: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"golden_{package}_schemas", _GOLDEN / package / "schemas.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


_PROBE_CONFIG = pydantic.ConfigDict(strict=True, allow_inf_nan=False)


def _validated(annotation: TypeForm[object], value: object) -> object:
    """`value` validated as a member annotated `annotation` in the generated models' strict config."""
    probe = pydantic.create_model("Probe", __config__=_PROBE_CONFIG, value=(annotation, ...))

    return probe.model_validate({"value": value}).model_dump()["value"]


def _accepts(annotation: TypeForm[object], value: object) -> bool:
    try:
        _validated(annotation, value)
    except pydantic.ValidationError:
        return False

    return True


@pytest.mark.parametrize("package", ["tasks", "tasks_consistent"])
def test_an_optional_member_that_is_not_nullable_refuses_null_and_stays_absent_when_left_out(package: str) -> None:
    create_task = _golden_schemas(package).CreateTask

    with pytest.raises(pydantic.ValidationError):
        create_task.model_validate({"title": "a", "effort": None})

    absent = create_task.model_validate({"title": "a"})

    assert absent.effort is None
    assert "effort" not in absent.model_fields_set
    assert create_task.model_validate({"title": "a", "effort": 3}).effort == 3


def test_the_generated_model_config_refuses_non_finite_numbers() -> None:
    config = _golden_schemas("tasks")._MODEL_CONFIG
    measured = pydantic.create_model("Measured", __config__=config, value=(float, ...))

    with pytest.raises(pydantic.ValidationError):
        measured.model_validate({"value": float("inf")})

    assert measured.model_validate({"value": 1.5}).model_dump() == {"value": 1.5}


@pytest.mark.parametrize(
    ("value", "accepted"),
    [
        (2**53 - 1, True),
        (-(2**53 - 1), True),
        (2**53, False),
        (-(2**53), False),
        (10**20, False),
        (float(2**53 - 1), True),
        (float(2**53), False),
    ],
)
def test_a_whole_number_stays_in_the_safe_integer_range(value: object, accepted: bool) -> None:
    assert _accepts(type_layer.WholeNumber, value) is accepted


@pytest.mark.parametrize(
    ("rule", "value", "accepted"),
    [
        (type_layer.bounds(maximum="0.1"), 0.1, True),
        (type_layer.bounds(minimum="0.1"), 0.1, True),
        (type_layer.bounds(exclusive_maximum="0.1"), 0.1, False),
        (type_layer.bounds(maximum="0.1"), 0.10000000000000002, False),
        (type_layer.multiple_of("0.1"), 0.3, True),
        (type_layer.multiple_of("0.1"), 0.7, True),
        (type_layer.multiple_of("0.1"), 0.35, False),
    ],
)
def test_consistent_bounds_and_multiples_compare_the_float_the_wire_wrote(
    rule: pydantic.AfterValidator, value: float, accepted: bool
) -> None:
    assert _accepts(Annotated[float, rule], value) is accepted


@pytest.mark.parametrize(
    ("value", "divisor", "accepted"),
    [(1e300, "0.01", True), (10**40, "3", False), (10**40, "5", True), (1.5e30, "7", False), (1.5e30, "0.5", True)],
)
def test_a_multiple_of_a_large_number_is_judged_without_raising(
    value: int | float, divisor: str, accepted: bool
) -> None:
    assert _accepts(Annotated[float, type_layer.multiple_of(divisor)], float(value)) is accepted

    if accepted:
        check_multiple_of(value, divisor)
    else:
        with pytest.raises(ValueRuleError, match="multipleOf"):
            check_multiple_of(value, divisor)


def test_a_bound_of_a_large_number_is_judged_without_raising() -> None:
    check_bounds(1e300, minimum="0.01")

    with pytest.raises(ValueRuleError, match="outside the bound 1e30"):
        check_bounds(10**40, maximum="1e30")


@pytest.mark.parametrize(
    ("text", "accepted"),
    [
        ("2026-01-02T03:04:05.123456789Z", True),
        ("2026-01-02T03:04:05.1234567890Z", False),
        ("2026-01-02T03:04:05+23:59", True),
        ("2026-01-02T03:04:05+05:60", False),
        ("2026-01-02T03:04:05+24:00", False),
    ],
)
def test_a_date_time_takes_one_to_nine_fraction_digits_and_a_valid_offset(text: str, accepted: bool) -> None:
    assert _accepts(type_layer.WireDateTime, text) is accepted


class _Color(StrEnum):
    RED = "red"


_RED = _Color.RED


@pytest.mark.parametrize(
    ("annotation", "value", "expected"),
    [
        (type_layer.WholeNumber, 1.0, 1),
        (type_layer.WholeNumber, 100, 100),
        (type_layer.WireDateTime, "2026-01-02t03:04:05.5z", datetime(2026, 1, 2, 3, 4, 5, 500000, tzinfo=UTC)),
        (
            type_layer.WireDateTime,
            "2026-01-02T03:04:05.123456789+02:00",
            datetime(2026, 1, 2, 3, 4, 5, 123456, tzinfo=timezone(timedelta(hours=2))),
        ),
        (type_layer.WireDate, "2026-02-28", date(2026, 2, 28)),
        (type_layer.WireUuid, "00000000-0000-0000-0000-00000000000A", UUID(int=10)),
        (type_layer.WireDecimal, "-0.50", Decimal("-0.50")),
        (type_layer.WireDecimal, "12345678901234567890.1", Decimal("12345678901234567890.1")),
        (Annotated[_Color, type_layer.enum_from_wire(_Color)], "red", _RED),
    ],
)
def test_the_type_layer_reads_a_wire_value_as_its_python_object(
    annotation: TypeForm[object], value: object, expected: object
) -> None:
    assert _validated(annotation, value) == expected


@pytest.mark.parametrize(
    ("annotation", "value"),
    [
        (type_layer.WholeNumber, 1.5),
        (type_layer.WholeNumber, True),
        (type_layer.WholeNumber, "1"),
        (type_layer.WholeNumber, 1e100),
        (type_layer.WireDateTime, "2026-01-02T03:04:05"),
        (type_layer.WireDateTime, "2026-01-02T03:04:60Z"),
        (type_layer.WireDateTime, "2026-01-02T24:00:00Z"),
        (type_layer.WireDateTime, "2026-01-02 03:04:05Z"),
        (type_layer.WireDate, "2026-02-30"),
        (type_layer.WireDate, "2026-2-3"),
        (type_layer.WireUuid, "00000000000000000000000000000000"),
        (type_layer.WireDecimal, "1e2"),
        (type_layer.WireDecimal, "01.5"),
        (type_layer.WireDecimal, ".5"),
        (type_layer.WireDecimal, 1.5),
        (Annotated[_Color, type_layer.enum_from_wire(_Color)], "blue"),
    ],
)
def test_the_type_layer_refuses_a_value_outside_its_wire_form(annotation: TypeForm[object], value: object) -> None:
    assert _accepts(annotation, value) is False


# A subscripted generic alias is a type expression; named at module level, the test can pass it as a value.
_OMITTABLE_INT = type_layer.Omittable[int]


@pytest.mark.parametrize(
    ("annotation", "value", "rule"),
    [
        (Annotated[str, type_layer.length(min_length=2)], "a", "minLength"),
        (Annotated[str, type_layer.length(max_length=1)], "\U0001f600a", "maxLength"),
        (Annotated[list[int], type_layer.length(max_length=1)], [1, 2], "maxLength"),
        (Annotated[int, type_layer.bounds(minimum="0")], -1, "minimum"),
        (Annotated[int, type_layer.bounds(exclusive_minimum="0")], 0, "exclusiveMinimum"),
        (Annotated[Decimal, type_layer.bounds(maximum="1.5")], Decimal("1.50001"), "maximum"),
        (Annotated[int, type_layer.multiple_of("3")], 4, "multipleOf"),
        (Annotated[str, type_layer.pattern("^a+$")], "ab", "pattern"),
        (type_layer.WireDate, "x", "format"),
        (type_layer.WholeNumber, 2**53, "type"),
        (_OMITTABLE_INT, None, "type"),
    ],
)
def test_a_consistent_rule_fails_with_the_contract_rule_name(
    annotation: TypeForm[object], value: object, rule: str
) -> None:
    with pytest.raises(pydantic.ValidationError) as refused:
        _validated(annotation, value)

    assert [error["type"] for error in refused.value.errors()] == [rule]


def test_a_code_point_counts_once_in_a_length() -> None:
    assert _accepts(Annotated[str, type_layer.length(max_length=1)], "\U0001f600") is True
