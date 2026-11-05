"""The fastapi target found through its entry point, its refusals by name, and the generated placement importing and
binding: `bind_<api>()` includes every contract route and adds the boundary as the outermost middleware."""

import importlib
import json
from collections.abc import Callable, Mapping
from importlib import metadata
from pathlib import Path

import fastapi
import pytest

from seampact.fastapi.generator import FastApiGenerator
from seampact.fastapi.runtime import ApiBinding, BindingError
from seampact.ir.config.json_value import JsonValue
from seampact.ir.read import read_ir
from seampact.ir.run.discovery import InstalledTarget, discover_target
from seampact.ir.run.generator import GenerationRefusedError

from .test_golden import reference_entry

_GOLDEN_PLACEMENT = "fastapi_tests.golden.reference.tasks.fastapi"


def _ir_json(repository_root: Path) -> dict[str, object]:
    loaded: dict[str, object] = json.loads(
        (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
    )
    return loaded


def _refusal_codes(
    ir_json: dict[str, object],
    options: Mapping[str, JsonValue] | None = None,
    artefacts: Mapping[str, JsonValue] | None = None,
) -> set[str]:
    generator = FastApiGenerator()
    ir = read_ir(json.dumps(ir_json), generator.ir_support())

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(ir, reference_entry("tasks", options, artefacts))

    return {problem.code for problem in refused.value.problems}


def test_the_generator_is_found_through_its_entry_point() -> None:
    found = discover_target("pypi:seampact-fastapi", "reference", metadata.distributions())

    assert isinstance(found, InstalledTarget)
    assert isinstance(found.generator, FastApiGenerator)


def test_options_outside_the_target_are_refused_by_name(repository_root: Path) -> None:
    options: dict[str, JsonValue] = {
        "handlers": "perOperation",
        "indent": 2,
        "layout": "flat",
        "suffixes": {},
        "rules": "loose",
        "catchAll": "yes",
        "routes": "file",
    }

    assert _refusal_codes(_ir_json(repository_root), options=options) == {
        "options.handlers.unsupported",
        "options.indent.unsupported",
        "options.layout.unsupported",
        "options.naming.unsupported",
        "options.rules.invalid",
        "options.catchAll.invalid",
        "options.unknown",
    }


def test_artefacts_the_target_does_not_take_yet_are_refused_by_name(repository_root: Path) -> None:
    artefacts: dict[str, JsonValue] = {
        "accessHooks": False,
        "bootCheck": {"hooks": "warn"},
        "client": True,
    }

    assert _refusal_codes(_ir_json(repository_root), artefacts=artefacts) == {
        "artefacts.accessHooks.unsupported",
        "artefacts.bootCheck.hooks.warn.unsupported",
        "artefacts.unknown",
    }


def test_a_boot_check_value_outside_its_set_is_refused_by_name(repository_root: Path) -> None:
    artefacts: dict[str, JsonValue] = {"bootCheck": {"frameworkRoutes": "loose", "hooks": "fail", "routes": True}}

    assert _refusal_codes(_ir_json(repository_root), artefacts=artefacts) == {
        "artefacts.bootCheck.frameworkRoutes.invalid",
        "artefacts.bootCheck.hooks.invalid",
        "artefacts.bootCheck.routes.invalid",
    }
    assert _refusal_codes(_ir_json(repository_root), artefacts={"bootCheck": "on"}) == {"artefacts.bootCheck.invalid"}


def test_contract_forms_the_target_does_not_serve_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    create_task = next(operation for operation in operations if operation["id"] == "createTask")
    get_task = next(operation for operation in operations if operation["id"] == "getTask")
    create_task["input"]["media"] = "multipart/form-data"
    get_task["responses"][0]["shape"] = "binary"

    assert _refusal_codes(ir_json) == {"input.media.unsupported", "response.binary.unsupported"}


def test_binding_includes_the_contract_routes_and_adds_the_boundary_outermost() -> None:
    placement = importlib.import_module(_GOLDEN_PLACEMENT)
    bind: Callable[..., None] = placement.bind_tasks
    app = fastapi.FastAPI()
    routes_before = list(app.routes)
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
    )

    bind(app, handlers=handlers)

    assert len(app.routes) > len(routes_before)
    assert isinstance(app.user_middleware[0].kwargs.get("binding"), ApiBinding)


def test_binding_a_router_without_the_app_is_refused_with_its_fix() -> None:
    placement = importlib.import_module(_GOLDEN_PLACEMENT)
    bind: Callable[..., None] = placement.bind_tasks
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
    )

    with pytest.raises(BindingError, match="app="):
        bind(fastapi.APIRouter(), handlers=handlers)


def test_the_generator_names_the_identity_headers_it_leaves_to_the_handler(repository_root: Path) -> None:
    generator = FastApiGenerator()
    text = (repository_root / "fixtures/golden/reference/tasksService.ir.json").read_text(encoding="utf-8")

    warnings = generator.handler_warnings(read_ir(text, generator.ir_support()), reference_entry("tasksService"))

    assert {warning.code for warning in warnings} == {"identity.headers.handler"}
    assert all(
        warning.where is not None and "entry 'reference' api 'tasksService'" in warning.where for warning in warnings
    )
