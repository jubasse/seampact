"""The ninja target found through its entry point; its options, artefacts and forms refused by name, the shared kept
forms among them; and the generated placement as Ninja reads it: each declared route registers on a Router without a
warning and resolves to its URL name, and `bind_<api>()` refuses by name before it changes the app."""

import importlib
import json
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
from seampact.ninja.runtime import ApiPlacement, BindingError, PlacementUnavailableError

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


def test_native_docs_and_artefacts_the_target_does_not_take_are_refused_by_name(repository_root: Path) -> None:
    artefacts: dict[str, JsonValue] = {"nativeDocs": True, "accessHooks": False, "bootCheck": {"hooks": "warn"}}

    assert _refusal_codes(_ir_json(repository_root), artefacts=artefacts) == {
        "artefacts.unknown",
        "artefacts.accessHooks.unsupported",
        "artefacts.bootCheck.hooks.unsupported",
    }


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


def test_binding_refuses_by_name_until_the_placement_runtime_serves_it() -> None:
    golden = _golden_placement()
    bind: Callable[..., None] = golden.bind_tasks
    factories = golden.TasksHandlerFactories(
        tasks=None, drafts=None, channels=None, preferences=None, app=None, hooks=None
    )

    with pytest.raises(PlacementUnavailableError, match=r"ninja\.placement\.unavailable"):
        bind(NinjaAPI(urls_namespace="seampact-ninja-bind"), prefix="", handlers=factories)

    with pytest.raises(BindingError, match="takes the app's NinjaAPI"):
        bind(object(), prefix="", handlers=factories)


def _snake(operation_id: str) -> str:
    return "".join(f"_{letter.lower()}" if letter.isupper() else letter for letter in operation_id)
