"""The target's own Python names: valid contract identifiers that meet a name the generated package writes itself (a
module alias of the placement, a field of an errors class) still give an importable package, and names two classes
of one module would share are refused as `name.collision`."""

import importlib
import json
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import fastapi
import pytest

from seampact.fastapi.generator import FastApiGenerator
from seampact.fastapi.runtime import PLACEMENT_UNAVAILABLE, PlacementUnavailableError
from seampact.ir.read import read_ir
from seampact.ir.run.generator import GenerationRefusedError

from .test_golden import reference_entry

type IrJson = dict[str, object]

_MODULE_ALIASES = ("runtime", "hooks", "abc", "typing", "dataclasses")


def _ir_json(repository_root: Path) -> IrJson:
    loaded: IrJson = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text("utf-8"))
    return loaded


def _generated_package(ir_json: IrJson, directory: Path, package: str, monkeypatch: pytest.MonkeyPatch) -> str:
    generator = FastApiGenerator()
    files = generator.generate(read_ir(json.dumps(ir_json), generator.ir_support()), reference_entry("tasks"))
    root = directory / package
    root.mkdir()

    for file in files:
        (root / file.path).write_text(file.contents, encoding="utf-8")

    monkeypatch.syspath_prepend(str(directory))

    return package


def _renamed_operation(ir_json: IrJson, operation_id: str, new_name: str) -> None:
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    operation = next(operation for operation in operations if operation["id"] == operation_id)
    operation["id"] = new_name
    operation["name"]["segments"] = [new_name]


def _with_error_code_renamed(ir_json: IrJson, code: str, new_code: str) -> IrJson:
    renamed: IrJson = json.loads(json.dumps(ir_json).replace(json.dumps(code), json.dumps(new_code)))
    return renamed


@pytest.mark.parametrize("alias", _MODULE_ALIASES)
def test_an_operation_named_after_a_placement_module_alias_still_binds(
    repository_root: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, alias: str
) -> None:
    ir_json = _ir_json(repository_root)
    _renamed_operation(ir_json, "health", alias)
    package = _generated_package(ir_json, tmp_path, f"alias_{alias}", monkeypatch)

    placement = importlib.import_module(f"{package}.fastapi")
    bind: Callable[..., None] = placement.bind_tasks
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
    )

    with pytest.raises(PlacementUnavailableError, match=PLACEMENT_UNAVAILABLE):
        bind(fastapi.FastAPI(), handlers=handlers)


def test_error_codes_named_like_the_errors_class_fields_keep_their_factories(
    repository_root: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ir_json = _with_error_code_renamed(_ir_json(repository_root), "state.conflict", "code")
    ir_json = _with_error_code_renamed(ir_json, "api.not_found", "params")
    package = _generated_package(ir_json, tmp_path, "error_fields", monkeypatch)

    types: ModuleType = importlib.import_module(f"{package}.operations")
    errors_class = types.ArchiveTaskErrors

    assert errors_class.code() == errors_class.code()
    assert errors_class.params() == errors_class.params()
    assert errors_class.code() != errors_class.params()


def test_an_exception_named_like_the_contract_error_base_is_refused(repository_root: Path) -> None:
    ir_json = _with_error_code_renamed(_ir_json(repository_root), "state.conflict", "tasks.contract")
    generator = FastApiGenerator()

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(read_ir(json.dumps(ir_json), generator.ir_support()), reference_entry("tasks"))

    assert "name.collision" in {problem.code for problem in refused.value.problems}


def test_a_form_no_python_target_serves_is_refused_by_the_target(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root)
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    operations[0]["upstream"] = ["billing"]
    generator = FastApiGenerator()

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(read_ir(json.dumps(ir_json), generator.ir_support()), reference_entry("tasks"))

    assert {problem.code for problem in refused.value.problems} == {"upstream.unsupported"}
