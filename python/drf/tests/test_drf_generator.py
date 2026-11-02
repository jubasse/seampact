"""The DRF target: the reference contract against its golden packages, which ruff, `ruff format --check` and
`mypy --strict` with the Django and DRF stubs check as the generated code of an app, on Django 5.2 and 6.x; the
generated package imported and routed; the options and forms the target refuses by name; its discovery through the
`seampact.generators` entry point. Set `SEAMPACT_UPDATE_GOLDEN=1` to write the golden packages again."""

import importlib
import importlib.util
import json
import os
import sys
from importlib import metadata
from pathlib import Path
from types import ModuleType

import pytest
from django.urls import URLPattern, get_resolver

from seampact.drf.generator import DrfGenerator
from seampact.drf.serializer_fields import RulesMode
from seampact.ir.config.json_value import JsonValue
from seampact.ir.model import ContractIR
from seampact.ir.read import read_ir
from seampact.ir.run.discovery import InstalledTarget, discover_target
from seampact.ir.run.generator import GenerationRefusedError, TargetEntry
from seampact.ir.run.matrix_framework import python_targets
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


def _serializer_attributes_ir(repository_root: Path) -> dict[str, JsonValue]:
    """The reference contract reduced to `createTask`, whose body gains members named after serializer attributes."""
    ir = reference_ir(repository_root, "tasks")
    operations = ir["operations"]
    schemas = ir["schemas"]
    assert isinstance(operations, list) and isinstance(schemas, dict)
    create_task = schemas["CreateTask"]
    assert isinstance(create_task, dict) and isinstance(create_task["properties"], list)
    title = create_task["properties"][0]
    assert isinstance(title, dict)
    create_task["properties"] += [{**title, "name": name} for name in _SERIALIZER_ATTRIBUTES]
    ir["operations"] = [
        operation for operation in operations if isinstance(operation, dict) and operation["id"] == "createTask"
    ]

    return ir


_SERIALIZER_ATTRIBUTES = ("data", "errors", "fields")


def test_members_named_like_serializer_attributes_validate_and_type_check(repository_root: Path) -> None:
    files = generated_files(contract(_serializer_attributes_ir(repository_root)))
    directory = Path(__file__).parent / "golden" / "serializer_attributes" / "tasks"

    if _UPDATE:
        write_package(files, directory)

    for file in files:
        assert file.contents == (directory / file.path).read_text(encoding="utf-8"), f"{file.path} differs"

    imported_package(directory, "seampact_drf_golden_serializer_attributes")
    drf = importlib.import_module("seampact_drf_golden_serializer_attributes.drf")
    body = {"title": "Plan", "data": "d", "errors": "e", "fields": "f"}
    serializer = drf.CreateTaskSerializer(data=body)

    assert serializer.is_valid(), serializer.errors
    assert {name: serializer.validated_data[name] for name in body} == body
    assert serializer.data["data"] == "d"


@pytest.mark.parametrize(
    ("options", "artefacts", "code"),
    [
        ({"handlers": "perOperation"}, {}, "options.handlers.unsupported"),
        ({"indent": 2}, {}, "options.indent.unsupported"),
        ({"rules": "strict"}, {}, "options.rules.invalid"),
        ({"catchAll": "no"}, {}, "options.catchAll.invalid"),
        ({"enumCase": "lower"}, {}, "options.naming.unsupported"),
        ({"layout": "flat"}, {}, "options.layout.unsupported"),
        ({"views": "async"}, {}, "options.unknown"),
        ({}, {"nativeDocs": True}, "artefacts.unknown"),
        ({}, {"accessHooks": False}, "artefacts.accessHooks.unsupported"),
        ({}, {"bootCheck": {"hooks": "warn"}}, "artefacts.bootCheck.hooks.unsupported"),
    ],
)
def test_options_and_artefacts_the_target_does_not_take_are_refused_by_name(
    repository_root: Path, options: dict[str, JsonValue], artefacts: dict[str, JsonValue], code: str
) -> None:
    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(reference_ir(repository_root, "tasks")), options, artefacts)

    assert [problem.code for problem in refused.value.problems] == [code]


def test_a_union_schema_is_refused_by_name_and_no_file_is_written(repository_root: Path) -> None:
    ir = reference_ir(repository_root, "tasks")
    schemas = ir["schemas"]
    assert isinstance(schemas, dict)
    schemas["Choice"] = {
        "kind": "union",
        "tag": {"in": "body", "property": "kind"},
        "id": "Choice",
        "name": {"role": "schema", "segments": ["choice"]},
        "variants": [],
        "directions": [],
        "examples": [],
        "docs": {},
        "extensions": {},
        "origin": {"layer": "api", "pointer": "/schemas/Choice"},
    }

    with pytest.raises(GenerationRefusedError, match=r"schema\.union\.unsupported .*/schemas/Choice"):
        generated_files(contract(ir))


def test_the_target_is_found_through_its_entry_point() -> None:
    found = discover_target("pypi:seampact-drf", "main", metadata.distributions())

    assert isinstance(found, InstalledTarget)
    assert isinstance(found.generator, DrfGenerator)


def test_the_matrix_checks_drf_by_major_with_django_as_a_companion() -> None:
    drf = python_targets()["pypi:seampact-drf"]

    assert [(framework.id, framework.floor, framework.tested) for framework in drf.frameworks] == [
        ("djangorestframework", "3.18", ("3",)),
        ("django", "5.2", ("5", "6")),
    ]
    assert drf.frameworks[1].is_below_floor(5, 1)
    assert drf.frameworks[1].unit_of(6, 1) == "6"
