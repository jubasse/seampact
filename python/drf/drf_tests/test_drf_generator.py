"""The DRF target: the reference contract against its golden packages, which ruff, `ruff format --check` and
`mypy --strict` with the Django and DRF stubs check as the generated code of an app, on Django 5.2 and 6.x; the
generated package imported and routed; the options and forms the target refuses by name; its discovery through the
`seampact.generators` entry point. Set `SEAMPACT_UPDATE_GOLDEN=1` to write the golden packages again."""

import importlib
import importlib.util
import json
import os
import sys
from datetime import UTC, date, datetime
from importlib import metadata
from pathlib import Path
from types import ModuleType

import pytest
from django.test import RequestFactory
from django.urls import URLPattern, get_resolver, reverse
from rest_framework.exceptions import ValidationError

from seampact.django.runtime import PlacementUnavailableError
from seampact.drf.generator import DrfGenerator
from seampact.drf.runtime import TypedValueField
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
        "reference", "pypi:seampact-drf", ir.api.id, None, options or {}, artefacts or {}, "/out", (), mount, None, ()
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
    assert resolver.resolve("/v1/channels/7/tasks/8").kwargs == {"path_channel_id": "7", "path_task_id": "8"}


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


def _golden_tasks() -> ModuleType:
    name = "seampact_drf_golden_tasks"

    return sys.modules.get(name) or imported_package(_GOLDEN / "tasks", name)


def _drf_of_golden_tasks() -> ModuleType:
    _golden_tasks()

    return importlib.import_module("seampact_drf_golden_tasks.drf")


def test_an_empty_string_runs_every_string_rule() -> None:
    drf = _drf_of_golden_tasks()
    empty_title = drf.CreateTaskSerializer(data={"title": ""})
    empty_sort = drf.ListTasksQuerySerializer(data={"sort": [""]})

    assert not empty_title.is_valid()
    assert empty_title.errors["title"][0].code == "min_length"
    assert not empty_sort.is_valid()
    assert empty_sort.errors["sort"][0][0].code == "pattern"


@pytest.mark.parametrize("title", ["a\u0000", "a\ud800", " padded "])
def test_a_contract_string_is_kept_as_sent(title: str) -> None:
    serializer = _drf_of_golden_tasks().CreateTaskSerializer(data={"title": title})

    assert serializer.is_valid(), serializer.errors
    assert serializer.validated_data["title"] == title


def test_every_route_name_reverses_to_its_operation_path(repository_root: Path) -> None:
    _golden_tasks()
    routes = importlib.import_module("seampact_drf_golden_tasks.routes")
    urlconf = "seampact_drf_golden_tasks.urls"
    resolver = get_resolver(urlconf)
    names = [value for key, value in vars(routes.TasksRouteNames).items() if key.isupper()]

    assert len(names) == len(contract(reference_ir(repository_root, "tasks")).operations)
    for name in names:
        candidates = resolver.reverse_dict.getlist(name)
        assert candidates, f"{name} is not registered"
        parameters = candidates[0][0][0][1]
        path = reverse(name, urlconf=urlconf, kwargs={parameter: "x" for parameter in parameters})
        assert resolver.resolve(path).url_name == name


def _renamed_draft_parameter(repository_root: Path, parameter: str) -> dict[str, JsonValue]:
    """The reference contract whose draft operations name their path parameter `parameter`."""
    ir = reference_ir(repository_root, "tasks")
    operations = ir["operations"]
    assert isinstance(operations, list)

    for operation in operations:
        assert isinstance(operation, dict) and isinstance(operation["path"], str)
        params = operation["params"]
        assert isinstance(params, dict) and isinstance(params["path"], list)

        if operation["path"] == "/v1/me/drafts/{draftId}":
            operation["path"] = "/v1/me/drafts/{" + parameter + "}"
            draft = params["path"][0]
            assert isinstance(draft, dict)
            draft["name"] = parameter

    return ir


@pytest.mark.parametrize("parameter", ["request", "self"])
def test_a_path_parameter_named_like_a_view_argument_reaches_the_view(
    repository_root: Path, tmp_path: Path, parameter: str
) -> None:
    package = f"seampact_drf_parameter_{parameter}"
    write_package(generated_files(contract(_renamed_draft_parameter(repository_root, parameter))), tmp_path / package)
    imported_package(tmp_path / package, package)
    match = get_resolver(f"{package}.urls").resolve("/v1/me/drafts/7")

    # The view runs until the admission step, which this release refuses by name.
    with pytest.raises(PlacementUnavailableError):
        match.func(RequestFactory().get("/v1/me/drafts/7"), *match.args, **match.kwargs)


def _query_parameters(repository_root: Path, operation_id: str, names: list[str]) -> dict[str, JsonValue]:
    """The reference contract whose operation `operation_id` gains a text query parameter per name."""
    ir = reference_ir(repository_root, "tasks")
    operations = ir["operations"]
    assert isinstance(operations, list)

    for operation in operations:
        assert isinstance(operation, dict)
        params = operation["params"]
        assert isinstance(params, dict) and isinstance(params["query"], list)

        if operation["id"] == operation_id:
            params["query"] += [
                {"name": name, "required": False, "type": {"kind": "scalar", "refinements": {}, "type": "string"}}
                for name in names
            ]

    return ir


def test_two_parameters_of_one_part_with_one_attribute_are_refused_naming_both(repository_root: Path) -> None:
    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(_query_parameters(repository_root, "listChannels", ["2fa", "field_2fa"])))

    problems = [problem for problem in refused.value.problems if problem.code == "name.collision"]
    assert len(problems) == 1
    assert "/params/query/2" in problems[0].message and "/params/query/3" in problems[0].message


def _limit_refinements(repository_root: Path, type_use: dict[str, JsonValue]) -> dict[str, JsonValue]:
    """The reference contract whose `listChannels` query parameter `limit` has the type `type_use`."""
    ir = reference_ir(repository_root, "tasks")
    operations = ir["operations"]
    assert isinstance(operations, list)

    for operation in operations:
        assert isinstance(operation, dict)
        params = operation["params"]
        assert isinstance(params, dict) and isinstance(params["query"], list)

        for param in params["query"]:
            assert isinstance(param, dict)

            if operation["id"] == "listChannels" and param["name"] == "limit":
                param["type"] = type_use

    return ir


@pytest.mark.parametrize(
    ("type_use", "code"),
    [
        (
            {"kind": "scalar", "type": "integer", "refinements": {"exclusiveMinimum": "0"}},
            "rule.exclusiveMinimum.unsupported",
        ),
        ({"kind": "scalar", "type": "number", "refinements": {"multipleOf": "0.5"}}, "rule.multipleOf.unsupported"),
        (
            {"kind": "scalar", "type": "string", "format": "decimal", "refinements": {"minimum": "1"}},
            "rule.minimum.unsupported",
        ),
        (
            {"kind": "scalar", "type": "string", "format": "date-time", "refinements": {"maxLength": 40}},
            "rule.maxLength.unsupported",
        ),
    ],
)
def test_a_value_rule_drf_cannot_check_under_native_is_refused_at_generate(
    repository_root: Path, type_use: dict[str, JsonValue], code: str
) -> None:
    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(_limit_refinements(repository_root, type_use)))

    assert [problem.code for problem in refused.value.problems] == [code]


def test_a_fractional_bound_on_an_integer_use_becomes_the_nearest_whole_number_inside_it(repository_root: Path) -> None:
    type_use: dict[str, JsonValue] = {
        "kind": "scalar",
        "type": "integer",
        "refinements": {"minimum": "1.5", "maximum": "9.5"},
    }

    files = generated_files(contract(_limit_refinements(repository_root, type_use)))
    contents = "\n".join(file.contents for file in files)

    assert "min_value=2" in contents
    assert "max_value=9" in contents


def test_a_form_no_python_target_serves_is_refused_by_the_drf_target(repository_root: Path) -> None:
    ir_json = reference_ir(repository_root, "tasks")
    operations = ir_json["operations"]
    assert isinstance(operations, list) and isinstance(operations[0], dict)
    operations[0]["upstream"] = ["billing"]

    with pytest.raises(GenerationRefusedError) as refused:
        generated_files(contract(ir_json))

    assert {problem.code for problem in refused.value.problems} == {"upstream.unsupported"}


def test_the_date_field_refuses_a_date_time() -> None:
    field = TypedValueField(date)

    with pytest.raises(ValidationError):
        field.run_validation(datetime(2026, 1, 2, tzinfo=UTC))

    assert field.run_validation(date(2026, 1, 2)) == date(2026, 1, 2)
