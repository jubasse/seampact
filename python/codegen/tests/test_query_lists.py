"""A query list of scalars or enums on an inline contract: kept by every Python target in the `repeat` form (repeated
keys) and the `comma` form (one comma-separated value), each item decoded and checked like a scalar parameter; a list
of objects, a nested list and the brackets form stay refused by name."""

import json
from collections.abc import Mapping
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Final

import pydantic
import pytest

import seampact.codegen.runtime.pydantic as type_layer
from seampact.codegen.kept_forms import refuse_kept_forms
from seampact.codegen.refusals import Refusals
from seampact.codegen.runtime.input_decoding import Issue
from seampact.codegen.runtime.pydantic.issues import part_issues
from seampact.codegen.runtime.wire_values import list_items, query_value, raw_query
from seampact.ir.read import IrSupport, read_ir
from seampact.ir.run.generator import GenerationRefusedError

_SUPPORT = IrSupport.of_model(kinds=["httpOperation"])
_INTEGER: Final = {"kind": "scalar", "type": "integer", "refinements": {}}
_STATE: Final = {"kind": "enum", "enum": "TaskState"}
_REPEAT: Final = {"kind": "list", "style": "form", "explode": True, "brackets": False}
_COMMA: Final = {"kind": "list", "style": "form", "explode": False, "brackets": False}

type IrJson = dict[str, object]


class _TaskState(StrEnum):
    OPEN = "open"
    DONE = "done"


class _ListTasksQuery(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(extra="forbid")

    state: list[Annotated[_TaskState, type_layer.enum_from_wire(_TaskState)]] | None = None
    score: list[type_layer.WholeNumber] | None = None


def _list_param(name: str, items: object, wire: object) -> IrJson:
    return {"name": name, "required": False, "type": {"kind": "array", "items": items}, "wire": wire}


def _with_list_tasks_query(repository_root: Path, *params: IrJson) -> IrJson:
    ir_json: IrJson = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text("utf-8"))
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    list_tasks = next(operation for operation in operations if operation["id"] == "listTasks")
    list_tasks["params"]["query"].extend(params)

    return ir_json


def _refusals_of(ir_json: IrJson) -> Refusals:
    refusals = Refusals("server", "test", "seampact-test")
    refuse_kept_forms(read_ir(json.dumps(ir_json), _SUPPORT), refusals)

    return refusals


def _decoded(raw: str, wires: Mapping[str, object], types: Mapping[str, object]) -> dict[str, object]:
    return {name: query_value(list_items(values, wires[name]), types[name]) for name, values in raw_query(raw).items()}


def test_a_list_of_enums_and_a_list_of_integers_are_kept_in_both_forms(repository_root: Path) -> None:
    ir_json = _with_list_tasks_query(
        repository_root, _list_param("state", _STATE, _REPEAT), _list_param("score", _INTEGER, _COMMA)
    )

    assert _refusals_of(ir_json).is_empty()


@pytest.mark.parametrize(
    "items",
    [
        {"kind": "ref", "schema": "Task"},
        {"kind": "array", "items": {"kind": "scalar", "type": "string", "refinements": {}}},
    ],
)
def test_a_list_of_objects_or_of_lists_stays_refused_by_name(repository_root: Path, items: IrJson) -> None:
    refusals = _refusals_of(_with_list_tasks_query(repository_root, _list_param("filter", items, _REPEAT)))

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    assert [problem.code for problem in refused.value.problems] == ["param.query.structured.unsupported"]
    assert refused.value.problems[0].message.startswith(
        "A query parameter that is not a scalar, an enum or a list of them in the form style is not"
    )


def test_a_list_in_brackets_form_stays_refused_by_name(repository_root: Path) -> None:
    brackets = {**_REPEAT, "brackets": True}
    refusals = _refusals_of(_with_list_tasks_query(repository_root, _list_param("state[]", _STATE, brackets)))

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    assert [problem.code for problem in refused.value.problems] == ["query.list.brackets.unsupported"]


def test_repeated_keys_and_a_comma_value_decode_each_item_by_its_type() -> None:
    wires = {"state": _REPEAT, "score": _COMMA}
    types = {"state": {"kind": "array", "items": _STATE}, "score": {"kind": "array", "items": _INTEGER}}

    decoded = _decoded("state=open&score=1,20&state=done", wires, types)

    assert decoded == {"state": ["open", "done"], "score": [1, 20]}
    assert _ListTasksQuery.model_validate(decoded, strict=True) == _ListTasksQuery(
        state=[_TaskState.OPEN, _TaskState.DONE], score=[1, 20]
    )


def test_an_invalid_item_is_one_issue_at_its_index() -> None:
    wires = {"state": _REPEAT, "score": _COMMA}
    types = {"state": {"kind": "array", "items": _STATE}, "score": {"kind": "array", "items": _INTEGER}}
    decoded = _decoded("state=open&state=lost&score=1,ten", wires, types)

    with pytest.raises(pydantic.ValidationError) as refused:
        _ListTasksQuery.model_validate(decoded, strict=True)

    issues = part_issues("query", {"state": "state", "score": "score"}, refused.value)

    assert issues == [Issue("query", "/state/1", "enum"), Issue("query", "/score/1", "type")]


def test_a_list_in_a_style_other_than_form_stays_refused_by_name(repository_root: Path) -> None:
    space_delimited = {**_COMMA, "style": "spaceDelimited"}
    refusals = _refusals_of(_with_list_tasks_query(repository_root, _list_param("tags", _INTEGER, space_delimited)))

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    assert [problem.code for problem in refused.value.problems] == ["param.query.structured.unsupported"]


def test_a_list_header_stays_refused_by_name(repository_root: Path) -> None:
    ir_json = _with_list_tasks_query(repository_root)
    operations = ir_json["operations"]
    assert isinstance(operations, list)
    list_tasks = next(operation for operation in operations if operation["id"] == "listTasks")
    list_tasks["params"]["header"].append(_list_param("X-Scores", _INTEGER, _COMMA))
    refusals = _refusals_of(ir_json)

    with pytest.raises(GenerationRefusedError) as refused:
        refusals.raise_if_any()

    assert [problem.code for problem in refused.value.problems] == ["param.header.structured.unsupported"]
    assert refused.value.problems[0].message.startswith("A header parameter that is not a scalar or an enum is not")
