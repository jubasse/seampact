"""Step 6's issues read back from Pydantic: each location as the wire's JSON pointer through the member tables, each
error type as the contract rule it stands for."""

from typing import Annotated

import pydantic
import pytest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.input_decoding import Issue
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.pydantic.issues import body_pointer, contract_rule, part_issues, proof_issues

_TASK = {"kind": "ref", "schema": "Task"}


class _PathPart(pydantic.BaseModel):
    channel_id: str


class _Proofs(pydantic.BaseModel):
    reauth_token: Annotated[str, pydantic.Field(min_length=1)]


def _contract() -> ApiContract:
    task: IrJson = {"kind": "object", "properties": [{"name": "due/At", "type": {"kind": "scalar", "type": "string"}}]}

    return ApiContract(
        api="tasks",
        generated_by="0.0.0-dev",
        mount="",
        ir_view={"schemas": {"Task": task}},
        members={"Task": {"due/At": "due_at"}},
        operation_members={},
    )


def _error(model: type[pydantic.BaseModel], value: object) -> pydantic.ValidationError:
    with pytest.raises(pydantic.ValidationError) as raised:
        model.model_validate(value, strict=True)

    return raised.value


def test_pydantic_error_types_read_as_contract_rules() -> None:
    assert contract_rule("string_too_short") == "minLength"
    assert contract_rule("extra_forbidden") == "unknownKeys"
    assert contract_rule("format") == "format"
    assert contract_rule("int_parsing") == "type"


def test_a_part_issue_points_at_the_wire_name() -> None:
    issues = part_issues("path", {"channelId": "channel_id"}, _error(_PathPart, {}))

    assert issues == [Issue("path", "/channelId", "required")]


def test_a_body_pointer_reads_attributes_back_to_escaped_wire_names_through_arrays() -> None:
    contract = _contract()
    tasks = {"kind": "array", "items": _TASK}

    assert body_pointer(contract, _TASK, ["due_at"]) == "/due~1At"
    assert body_pointer(contract, tasks, [2, "due_at"]) == "/2/due~1At"


def test_a_proof_issue_points_at_the_proof_body_member() -> None:
    proofs = {"reauthToken": {"kind": "scalar", "type": "string", "refinements": {"minLength": 1}}}
    error = _error(_Proofs, {"reauth_token": ""})

    issues = proof_issues(_contract(), proofs, {"reauthToken": "reauth_token"}, error)

    assert issues == [Issue("body", "/reauthToken", "minLength")]


class _HeaderPart(pydantic.BaseModel):
    idempotency_key: str


def test_a_header_issue_names_its_header_in_lower_case() -> None:
    issues = part_issues("header", {"Idempotency-Key": "idempotency_key"}, _error(_HeaderPart, {}))

    assert issues == [Issue("header", "/idempotency-key", "required")]
