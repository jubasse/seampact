"""The type layer of the generated Pydantic models (`seampact.codegen.runtime.pydantic`), alone and through the
reference golden models."""

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Annotated

import pydantic
import pytest

import seampact.codegen.runtime.pydantic as type_layer

_GOLDEN = Path(__file__).parent / "golden" / "reference"


def _golden_schemas(package: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"golden_{package}_schemas", _GOLDEN / package / "schemas.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    return module


def _adapter(annotation: object) -> pydantic.TypeAdapter[object]:
    return pydantic.TypeAdapter(annotation, config=pydantic.ConfigDict(strict=True, allow_inf_nan=False))


def _accepts(annotation: object, value: object) -> bool:
    try:
        _adapter(annotation).validate_python(value)
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

    assert measured.model_validate({"value": 1.5}).value == 1.5


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
