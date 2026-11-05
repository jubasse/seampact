"""The forms the generated boundary leaves to the handler, which every Python target names with a warning: the
reference `tasksService` identity declares the rights-version header, so each of its operations warns."""

import json
from pathlib import Path

from seampact.codegen.handler_forms import IDENTITY_HEADERS_HANDLER, handler_warnings
from seampact.ir.read import IrSupport, read_ir

_SUPPORT = IrSupport.of_model(kinds=["httpOperation"])


def _reference_ir_text(repository_root: Path, api: str) -> str:
    return (repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text("utf-8")


def test_an_identity_with_headers_warns_by_name_on_each_operation_that_uses_it(repository_root: Path) -> None:
    ir_text = _reference_ir_text(repository_root, "tasksService")
    operations = json.loads(ir_text)["operations"]
    warnings = handler_warnings(read_ir(ir_text, _SUPPORT), "server")
    get_task = next(warning for warning in warnings if "(operation 'getTask')" in (warning.where or ""))
    get_task_index = next(index for index, operation in enumerate(operations) if operation["id"] == "getTask")

    assert {warning.code for warning in warnings} == {IDENTITY_HEADERS_HANDLER}
    assert get_task.where == f"entry 'server' /operations/{get_task_index}/access (operation 'getTask')"
    assert "is not enforced by the generated boundary" in get_task.message
    assert get_task.fix == "Read the identity headers the boundary validated in the handler."


def test_an_identity_without_headers_does_not_warn(repository_root: Path) -> None:
    assert handler_warnings(read_ir(_reference_ir_text(repository_root, "tasks"), _SUPPORT), "server") == []
