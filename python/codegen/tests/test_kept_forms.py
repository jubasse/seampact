"""The contract forms no Python target serves, refused by name for every target alike: the reference contract passes,
and each form absent from it is refused with its code."""

import json
from pathlib import Path

import pytest

from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.refusals import Refusals
from seampact.ir.model import ContractIR
from seampact.ir.read import IrSupport, read_ir
from seampact.ir.run.generator import GenerationRefusedError

_SUPPORT = IrSupport.of_model(kinds=["httpOperation"])

type IrJson = dict[str, object]


def _ir_json(repository_root: Path, api: str) -> IrJson:
    loaded: IrJson = json.loads((repository_root / f"fixtures/golden/reference/{api}.ir.json").read_text("utf-8"))
    return loaded


def _operation(ir_json: IrJson, operation_id: str) -> dict[str, object]:
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    found: dict[str, object] = next(operation for operation in operations if operation["id"] == operation_id)
    return found


def _refusals_of(ir: ContractIR) -> Refusals:
    refusals = Refusals("server", "test", "seampact-test")
    refuse_kept_forms(ir, refusals)
    return refusals


def _refused_codes(ir_json: IrJson) -> dict[str, str]:
    refusals = _refusals_of(read_ir(json.dumps(ir_json), _SUPPORT))

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    return {problem.code: problem.message for problem in refused.value.problems}


@pytest.mark.parametrize("api", ["tasks", "tasksService"])
def test_the_reference_contract_has_no_kept_form(repository_root: Path, api: str) -> None:
    assert _refusals_of(read_ir(json.dumps(_ir_json(repository_root, api)), _SUPPORT)).is_empty()


def test_operation_members_absent_from_the_reference_wait_for_a_consumer_after_1_0(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    get_task = _operation(ir_json, "getTask")
    get_task["upstream"] = ["billing"]
    get_task["principalRequires"] = [
        {"field": "verified", "origin": {"layer": "api", "pointer": "/principalRequires/0"}}
    ]

    refused = _refused_codes(ir_json)

    assert set(refused) == {"upstream.unsupported", "principalRequires.unsupported"}
    assert "it comes after 1.0" in refused["upstream.unsupported"]


def test_an_open_enum_and_a_parameter_default_are_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    enums = ir_json["enums"]
    assert isinstance(enums, dict)
    enums["TaskState"]["fallback"] = enums["TaskState"]["values"][0]
    params = _operation(ir_json, "listTasks")["params"]
    assert isinstance(params, dict)
    params["query"][1]["default"] = 20

    assert set(_refused_codes(ir_json)) == {"enum.open.unsupported", "param.default.unsupported"}


def test_a_format_meta_member_is_refused_by_name(repository_root: Path) -> None:
    ir_json = _ir_json(repository_root, "tasks")
    formats = ir_json["formats"]
    assert isinstance(formats, dict)
    format_id = str(_operation(ir_json, "getTask")["format"])
    formats[format_id]["meta"] = {
        "traceId": {"type": {"kind": "scalar", "type": "string", "refinements": {}}, "fill": "traceId"}
    }

    assert "format.meta.unsupported" in _refused_codes(ir_json)
