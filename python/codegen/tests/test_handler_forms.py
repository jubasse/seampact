"""The forms the generated boundary leaves to the handler, which every Python target names with a warning: the
reference `tasksService` identity declares request headers (`actorSurface`, `deadline`, `trace`), so each of its
operations warns. An identity header written on a response is refused by name instead."""

import json
from pathlib import Path

import pytest

from seampact.codegen.handler_forms import IDENTITY_HEADERS_HANDLER, handler_warnings
from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.refusals import Refusals
from seampact.ir.read import IrSupport, read_ir
from seampact.ir.run.generator import GenerationRefusedError

_SUPPORT = IrSupport.of_model(kinds=["httpOperation"])


def _reference_ir_text(repository_root: Path, api: str) -> str:
    return (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text("utf-8")


def test_an_identity_with_headers_warns_by_name_on_each_operation_that_uses_it(repository_root: Path) -> None:
    ir_text = _reference_ir_text(repository_root, "tasksService")
    operations = json.loads(ir_text)["operations"]
    warnings = handler_warnings(read_ir(ir_text, _SUPPORT), "server", "tasksService")
    get_task = next(warning for warning in warnings if "(operation 'getTask')" in (warning.where or ""))
    get_task_index = next(index for index, operation in enumerate(operations) if operation["id"] == "getTask")

    assert {warning.code for warning in warnings} == {IDENTITY_HEADERS_HANDLER}
    assert (
        get_task.where == f"entry 'server' api 'tasksService' /operations/{get_task_index}/access (operation 'getTask')"
    )
    assert "is not enforced by the generated boundary" in get_task.message
    assert get_task.fix == "Read the identity headers the boundary validated in the handler."


def test_an_identity_without_headers_does_not_warn(repository_root: Path) -> None:
    assert handler_warnings(read_ir(_reference_ir_text(repository_root, "tasks"), _SUPPORT), "server", "tasks") == []


def test_an_identity_header_written_on_a_response_is_refused_by_name_at_its_declaration(repository_root: Path) -> None:
    ir_json = json.loads(_reference_ir_text(repository_root, "tasksService"))
    ir_json["headers"]["trace"]["in"] = "response"
    ir_json["headers"]["rightsVersion"] = {
        "id": "rightsVersion",
        "semantic": "versionToken",
        "response": "X-Rights-Version",
        "request": "If-Rights-Version",
        "origin": {"layer": "shared", "pointer": "/headers/rightsVersion"},
    }
    ir_json["identities"]["service"]["headers"].append(
        {
            "header": "rightsVersion",
            "for": "writes",
            "required": False,
            "origin": {"layer": "shared", "pointer": "/identities/service/headers/rightsVersion"},
        }
    )
    refusals = Refusals("server", "test", "seampact-test")

    refuse_kept_forms(read_ir(json.dumps(ir_json), _SUPPORT), refusals)

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()
    get_task = {problem.where: problem for problem in refused.value.problems if "'getTask'" in (problem.where or "")}

    assert {problem.code for problem in refused.value.problems} == {"identity.response.header.unsupported"}
    assert set(get_task) == {
        "entry 'server' /headers/trace (operation 'getTask')",
        "entry 'server' /headers/rightsVersion (operation 'getTask')",
    }
    assert "The response header 'X-Rights-Version' of the identity 'service'" in (
        get_task["entry 'server' /headers/rightsVersion (operation 'getTask')"].message
    )


def test_a_response_header_whose_for_excludes_an_operation_is_not_refused_on_it(repository_root: Path) -> None:
    ir_json = json.loads(_reference_ir_text(repository_root, "tasksService"))
    ir_json["headers"]["trace"]["in"] = "response"

    for use in ir_json["identities"]["service"]["headers"]:
        if use["header"] == "trace":
            use["for"] = "writes"

    refusals = Refusals("server", "test", "seampact-test")

    refuse_kept_forms(read_ir(json.dumps(ir_json), _SUPPORT), refusals)

    refusals.raise_if_any()


def test_an_identity_with_only_response_headers_does_not_warn(repository_root: Path) -> None:
    ir_json = json.loads(_reference_ir_text(repository_root, "tasksService"))

    for declaration in ir_json["headers"].values():
        declaration["in"] = "response"

    assert handler_warnings(read_ir(json.dumps(ir_json), _SUPPORT), "server", "tasksService") == []
