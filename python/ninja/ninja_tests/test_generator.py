"""The ninja target found through its entry point; its options, artefacts and forms refused by name, the shared kept
forms among them; and the generated placement as Ninja reads it: each declared route registers on a Router without a
warning and resolves to its URL name, and `bind_<api>()` takes only a NinjaAPI."""

import dataclasses
import importlib
import json
import os
import subprocess
import sys
from collections.abc import Callable, Mapping
from importlib import metadata
from pathlib import Path
from types import ModuleType

import pytest
from django.urls import URLResolver, path
from django.urls.resolvers import RegexPattern
from ninja import NinjaAPI, Router

from seampact.ir.config.json_value import JsonValue
from seampact.ir.read import read_ir
from seampact.ir.run.discovery import InstalledTarget, discover_target
from seampact.ir.run.generator import GenerationRefusedError
from seampact.ninja.generator import NinjaGenerator
from seampact.ninja.runtime import ApiPlacement, BindingError

from .test_golden import reference_entry

_GOLDEN_PLACEMENT = "ninja_tests.golden.reference.tasks.ninja"


def _ir_json(repository_root: Path) -> dict[str, JsonValue]:
    loaded: dict[str, JsonValue] = json.loads(
        (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
    )
    return loaded


def _operation(ir_json: dict[str, JsonValue], operation_id: str) -> dict[str, JsonValue]:
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    found = next(item for item in operations if isinstance(item, dict) and item["id"] == operation_id)
    assert isinstance(found, dict)
    return found


def _refusal_codes(
    ir_json: dict[str, JsonValue],
    options: Mapping[str, JsonValue] | None = None,
    artefacts: Mapping[str, JsonValue] | None = None,
) -> set[str]:
    generator = NinjaGenerator()
    ir = read_ir(json.dumps(ir_json), generator.ir_support())

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(ir, reference_entry("tasks", options, artefacts))

    return {problem.code for problem in refused.value.problems}


def _golden_placement() -> ModuleType:
    return importlib.import_module(_GOLDEN_PLACEMENT)


def test_the_generator_is_found_through_its_entry_point() -> None:
    found = discover_target("pypi:seampact-ninja", "reference", metadata.distributions())

    assert isinstance(found, InstalledTarget)
    assert isinstance(found.generator, NinjaGenerator)


def test_the_generator_imports_without_django_settings_or_ninja() -> None:
    # `seampact generate` runs outside any Django project, where importing Ninja fails on unconfigured settings.
    environment = {name: value for name, value in os.environ.items() if name != "DJANGO_SETTINGS_MODULE"}
    probe = "import sys, seampact.ninja.generator; print('ninja' in sys.modules)"
    finished = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, env=environment, check=False
    )

    assert finished.returncode == 0, finished.stderr
    assert finished.stdout.strip() == "False"


def test_options_outside_the_target_are_refused_by_name(repository_root: Path) -> None:
    options: dict[str, JsonValue] = {
        "handlers": "perOperation",
        "indent": 2,
        "layout": "flat",
        "suffixes": {},
        "rules": "loose",
        "views": "threads",
        "catchAll": "yes",
        "routes": "file",
    }

    assert _refusal_codes(_ir_json(repository_root), options=options) == {
        "options.handlers.unsupported",
        "options.indent.unsupported",
        "options.layout.unsupported",
        "options.naming.unsupported",
        "options.rules.invalid",
        "options.views.invalid",
        "options.catchAll.invalid",
        "options.unknown",
    }


def test_artefacts_the_target_does_not_take_are_refused_by_name(repository_root: Path) -> None:
    artefacts: dict[str, JsonValue] = {"nativeDocs": "yes", "accessHooks": False, "bootCheck": {"hooks": "warn"}}

    assert _refusal_codes(_ir_json(repository_root), artefacts=artefacts) == {
        "artefacts.unknown",
        "artefacts.accessHooks.unsupported",
        "artefacts.bootCheck.hooks.warn.unsupported",
    }


def test_an_entry_whose_target_has_no_matrix_row_is_refused_by_name(repository_root: Path) -> None:
    generator = NinjaGenerator()
    ir = read_ir(json.dumps(_ir_json(repository_root)), generator.ir_support())

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(ir, dataclasses.replace(reference_entry("tasks"), matrix=None))

    assert {problem.code for problem in refused.value.problems} == {"config.matrix.row-missing"}


def test_framework_docs_off_names_ninjas_own_switch() -> None:
    fix = NinjaGenerator().framework_docs_off_fix()

    assert fix is not None
    assert "NinjaAPI(docs_url=None, openapi_url=None)" in fix


def test_contract_forms_the_target_does_not_serve_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    create_task = _operation(ir_json, "createTask")
    create_task_input = create_task["input"]
    assert isinstance(create_task_input, dict)
    create_task_input["media"] = "multipart/form-data"

    assert _refusal_codes(ir_json) == {"input.media.unsupported"}


def test_a_form_body_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    create_task_input = _operation(ir_json, "createTask")["input"]
    assert isinstance(create_task_input, dict)
    create_task_input["media"] = "application/x-www-form-urlencoded"

    assert _refusal_codes(ir_json) == {"input.media.unsupported"}


def test_a_file_download_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    responses = _operation(ir_json, "getTask")["responses"]
    assert isinstance(responses, list)
    download = responses[0]
    assert isinstance(download, dict)
    download["shape"] = "binary"
    download["body"] = {"kind": "file", "media": ["application/pdf"]}
    del download["media"]

    assert "response.binary.unsupported" in _refusal_codes(ir_json)


def test_a_query_list_in_brackets_form_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    query_params = _operation(ir_json, "listTasks")["params"]
    assert isinstance(query_params, dict)
    query = query_params["query"]
    assert isinstance(query, list)
    sort = next(param for param in query if isinstance(param, dict) and param["name"] == "sort")
    list_wire = sort["wire"]
    assert isinstance(list_wire, dict)
    list_wire["explode"] = True
    list_wire["brackets"] = True

    assert _refusal_codes(ir_json) == {"query.list.brackets.unsupported"}


def test_a_union_and_a_redirect_response_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    schemas = ir_json["schemas"]
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
    responses = _operation(ir_json, "getTask")["responses"]
    assert isinstance(responses, list) and isinstance(responses[0], dict)
    responses[0]["shape"] = "redirect"

    assert _refusal_codes(ir_json) == {"schema.union.unsupported", "response.redirect.unsupported"}


def test_the_forms_no_python_target_serves_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    _operation(ir_json, "getTask")["upstream"] = ["billing"]

    assert _refusal_codes(ir_json) == {"upstream.unsupported"}


def test_each_declared_route_registers_on_a_router_and_resolves_to_its_url_name() -> None:
    golden = _golden_placement()
    placement = golden.PLACEMENT
    assert isinstance(placement, ApiPlacement)
    router = Router()

    for route in placement.routes:
        view = getattr(golden, f"_view_{_snake(route.operation_id)}")
        router.add_api_operation(route.path, list(route.methods), view, include_in_schema=False, url_name=route.name)

    api = NinjaAPI(urls_namespace="seampact-ninja-routes")
    api.add_router("", router)
    resolver = URLResolver(RegexPattern(r"^/"), [path("", api.urls)])

    for route in placement.routes:
        match = resolver.resolve(route.path.replace("{", "").replace("}", ""))

        assert match.url_name == route.name
        assert match.namespace == "seampact-ninja-routes"

    assert [route.methods for route in placement.routes if route.operation_id == "getTask"] == [("GET", "HEAD")]


def test_binding_takes_only_a_ninja_api() -> None:
    golden = _golden_placement()
    bind: Callable[..., None] = golden.bind_tasks
    factories = golden.TasksHandlerFactories(
        tasks=None, drafts=None, channels=None, preferences=None, app=None, hooks=None
    )

    with pytest.raises(BindingError, match="takes the app's NinjaAPI"):
        bind(object(), prefix="", handlers=factories)


def _snake(operation_id: str) -> str:
    return "".join(f"_{letter.lower()}" if letter.isupper() else letter for letter in operation_id)


def test_the_generator_names_the_identity_headers_it_leaves_to_the_handler(repository_root: Path) -> None:
    generator = NinjaGenerator()
    text = (repository_root / "fixtures/golden/reference/tasksService.ir.json").read_text(encoding="utf-8")

    warnings = generator.handler_warnings(read_ir(text, generator.ir_support()), reference_entry("tasksService"))

    assert {warning.code for warning in warnings} == {"identity.headers.handler"}
    assert all(
        warning.where is not None and "entry 'reference' api 'tasksService'" in warning.where for warning in warnings
    )
