"""The DRF target: the reference contract against its golden packages, which ruff, `ruff format --check` and
`mypy --strict` with the Django and DRF stubs check as the generated code of an app, on Django 5.2 and 6.x; the
generated package imported and routed; the options and forms the target refuses by name; its discovery through the
`seampact.generators` entry point. Set `SEAMPACT_UPDATE_GOLDEN=1` to write the golden packages again."""

import importlib
import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest
from django.urls import URLPattern, get_resolver

from seampact.drf.generator import DrfGenerator
from seampact.drf.serializer_fields import RulesMode
from seampact.ir.config.json_value import JsonValue
from seampact.ir.model import ContractIR
from seampact.ir.read import read_ir
from seampact.ir.run.generator import TargetEntry
from seampact.ir.write import GeneratedFile

_GOLDEN = Path(__file__).parent / "golden" / "reference"
_UPDATE = os.environ.get("SEAMPACT_UPDATE_GOLDEN") == "1"


def reference_ir(repository_root: Path, api: str) -> dict[str, JsonValue]:
    ir: dict[str, JsonValue] = json.loads(
        (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text(encoding="utf-8")
    )

    return ir


def contract(ir_json: dict[str, JsonValue]) -> ContractIR:
    return read_ir(json.dumps(ir_json), DrfGenerator().ir_support())


def generated_files(
    ir: ContractIR,
    options: dict[str, JsonValue] | None = None,
    artefacts: dict[str, JsonValue] | None = None,
    mount: str | None = None,
) -> list[GeneratedFile]:
    entry = TargetEntry(
        "reference", "pypi:seampact-drf", ir.api.id, None, options or {}, artefacts or {}, "/out", (), mount
    )

    return list(DrfGenerator().generate(ir, entry))


def write_package(files: list[GeneratedFile], directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)

    for file in files:
        (directory / file.path).write_text(file.contents, encoding="utf-8")


def imported_package(directory: Path, name: str) -> ModuleType:
    """The package in `directory`, imported as `name`; its `drf` and `urls` modules imported too."""
    spec = importlib.util.spec_from_file_location(
        name, directory / "__init__.py", submodule_search_locations=[str(directory)]
    )
    assert spec is not None and spec.loader is not None
    package = importlib.util.module_from_spec(spec)
    sys.modules[name] = package
    spec.loader.exec_module(package)

    for module in ("drf", "urls", "django", "settings"):
        importlib.import_module(f"{name}.{module}")

    return package


@pytest.mark.parametrize(("api", "package"), [("tasks", "tasks"), ("tasksService", "tasks_service")])
def test_the_reference_contract_matches_its_golden_package(repository_root: Path, api: str, package: str) -> None:
    files = generated_files(contract(reference_ir(repository_root, api)))
    directory = _GOLDEN / package

    if _UPDATE:
        directory.mkdir(parents=True, exist_ok=True)

        for file in files:
            (directory / file.path).write_text(file.contents, encoding="utf-8")

    written = sorted(path.name for path in directory.glob("*.py"))

    assert [file.path for file in files] == written
    for file in files:
        assert file.contents == (directory / file.path).read_text(encoding="utf-8"), (
            f"{directory / file.path} differs; run with SEAMPACT_UPDATE_GOLDEN=1"
        )


def test_the_golden_package_imports_and_routes_each_contract_path() -> None:
    imported_package(_GOLDEN / "tasks", "seampact_drf_golden_tasks")
    urls = importlib.import_module("seampact_drf_golden_tasks.urls")
    patterns = [pattern for pattern in urls.urlpatterns if isinstance(pattern, URLPattern)]
    resolver = get_resolver("seampact_drf_golden_tasks.urls")
    match = resolver.resolve("/v1/channels/7/tasks/search")

    assert len(patterns) == len(urls.urlpatterns)
    assert match.url_name == "seampact.tasks.searchTasks"
    assert resolver.resolve("/v1/channels/7/tasks/8").kwargs == {"channel_id": "7", "task_id": "8"}


def test_seampact_consistent_rules_are_generated_validators(repository_root: Path) -> None:
    native = {file.path: file.contents for file in generated_files(contract(reference_ir(repository_root, "tasks")))}
    consistent = {
        file.path: file.contents
        for file in generated_files(
            contract(reference_ir(repository_root, "tasks")), options={"rules": RulesMode.SEAMPACT_CONSISTENT.value}
        )
    }

    assert "min_length=" in native["drf.py"]
    assert "_drf_runtime.length(" not in native["drf.py"]
    assert "_drf_runtime.length(" in consistent["drf.py"]
    assert {path for path in native if native[path] != consistent[path]} == {"drf.py"}
