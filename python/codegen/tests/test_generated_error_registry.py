"""The error registry of the Python server targets: each code the contract declares is defined once, with its
status and params, as the class a handler raises."""

import importlib.util
import inspect
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Final

import pytest

_PYTHON: Final = Path(__file__).resolve().parents[2]
# The golden package of each target for the reference api `tasks`, the attribute that holds a class's code and the
# one that holds its status (DRF answers the status from the contract, not from the class).
_GOLDEN_PACKAGES: Final = {
    "fastapi": (_PYTHON / "fastapi/fastapi_tests/golden/reference/tasks", "CODE", "STATUS"),
    "drf": (_PYTHON / "drf/drf_tests/golden/reference/tasks", "code", None),
    "ninja": (_PYTHON / "ninja/ninja_tests/golden/reference/tasks", "CODE", "STATUS"),
}
_BASE_CLASS: Final = "TasksContractError"


def _imported_operations(target: str, directory: Path) -> ModuleType:
    name = f"seampact_registry_proof_{target}"
    spec = importlib.util.spec_from_file_location(
        name, directory / "__init__.py", submodule_search_locations=[str(directory)]
    )
    assert spec is not None and spec.loader is not None
    package = importlib.util.module_from_spec(spec)
    sys.modules[name] = package
    spec.loader.exec_module(package)

    return importlib.import_module(f"{name}.operations")


def _registry_of_the_contract_module(target: str) -> dict[str, dict[str, Any]]:
    registry: dict[str, dict[str, Any]] = importlib.import_module(
        f"seampact_registry_proof_{target}.contract"
    ).CONTRACT.ir_view["errors"]

    return registry


def _error_classes(operations: ModuleType) -> list[type]:
    base: Any = getattr(operations, _BASE_CLASS)

    return [
        member
        for member in vars(operations).values()
        if inspect.isclass(member) and issubclass(member, base) and member is not base
    ]


@pytest.mark.parametrize("target", sorted(_GOLDEN_PACKAGES))
def test_each_declared_error_code_is_one_class_with_its_status_and_params(repository_root: Path, target: str) -> None:
    directory, code_attribute, status_attribute = _GOLDEN_PACKAGES[target]
    text = (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
    declared = json.loads(text)["errors"]
    defined = _error_classes(_imported_operations(target, directory))

    assert sorted(getattr(error, code_attribute) for error in defined) == sorted(declared)

    classes = {getattr(error, code_attribute): error for error in defined}

    for code, error in declared.items():
        own_constructor = vars(classes[code]).get("__init__")
        takes_params = own_constructor is not None and "params" in inspect.signature(own_constructor).parameters

        assert takes_params == ("params" in error), code

        if status_attribute is not None:
            assert getattr(classes[code], status_attribute) == error["http"]["status"], code
    registry = _registry_of_the_contract_module(target)
    examples = {code: error["example"] for code, error in declared.items() if "example" in error}

    assert sorted(examples) == ["api.rate_limited", "api.schema_invalid"]
    assert {code: error.get("example") for code, error in registry.items()} == {
        code: error.get("example") for code, error in declared.items()
    }
