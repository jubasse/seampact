"""Field rights: a restricted input member sent without its right is refused, and a restricted output member is left
out for each holder the decider denies, one decision per subject."""

import asyncio
import copy
import dataclasses
from dataclasses import dataclass, field

import pytest

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState, HookCaller
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.field_rights import checked_input_fields, visible_output
from seampact.codegen.runtime.ir_view import IrJson
from seampact.hooks import (
    Decision,
    ErrorCodeWithParams,
    FieldDirection,
    RequestView,
    RequirementRequest,
    ResolvedScope,
    decision,
    purpose,
)

_CHANNEL = "8a6e0804-2bd0-4672-b79d-d97027f9071a"
_FORBIDDEN = "api.forbidden"


@dataclass
class _Decider:
    """Allows the subjects in `allowed`, or every request when `allowed` is None; records each request."""

    allowed: frozenset[object] | None = None
    asked: list[RequirementRequest] = field(default_factory=list)

    def decide(self, request: RequirementRequest, /) -> Decision:
        self.asked.append(request)
        subject = None if request.subject is None else request.subject.id

        if self.allowed is None or subject in self.allowed:
            return decision.Allowed()

        return decision.Denied(deny=ErrorCodeWithParams(code=_FORBIDDEN))


def _state(contract: ApiContract, operation_id: str, body: object) -> AccessState:
    return AccessState(
        contract=contract,
        operation_id=operation_id,
        credentials_types={},
        raw_parameters={"channelId": _CHANNEL},
        request=RequestView(method="GET", path="/v1/channels", headers={}),
        body=body,
        principal=None,
        scopes=[ResolvedScope(scope="channel", id=_CHANNEL)],
    )


def _hooks(name: str, decider: _Decider) -> AccessHooks:
    return AccessHooks(authenticate={}, deciders={name: decider}, scope_resolvers={})


def test_a_denied_output_member_is_left_out_once_per_holder(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    decider = _Decider(allowed=frozenset({"t1"}))
    items = [{"taskId": "t1", "effort": 3}, {"taskId": "t2", "effort": 5}, {"taskId": "t1", "effort": 3}]
    response = tasks_contract.operation("listTasks")["responses"]
    assert isinstance(response, list)

    visible = asyncio.run(
        visible_output(
            _state(tasks_contract, "listTasks", None),
            _hooks("tasks.seeEffort", decider),
            hook_caller,
            response[0],
            items,
        )
    )

    assert visible == [{"taskId": "t1", "effort": 3}, {"taskId": "t2"}, {"taskId": "t1", "effort": 3}]
    assert items[1] == {"taskId": "t2", "effort": 5}
    assert [request.subject.id for request in decider.asked if request.subject is not None] == ["t1", "t2"]
    assert decider.asked[0].purpose == purpose.Field(pointer="/effort", direction=FieldDirection.OUTPUT)


def _list_tasks_output(contract: ApiContract, items: object, decider: _Decider, call: HookCaller) -> object:
    response = contract.operation("listTasks")["responses"]
    assert isinstance(response, list)

    return asyncio.run(
        visible_output(
            _state(contract, "listTasks", None), _hooks("tasks.seeEffort", decider), call, response[0], items
        )
    )


def _with_output_pointer(contract: ApiContract, pointer: str) -> ApiContract:
    """`listTasks` with its output field right moved to `pointer`."""
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(contract.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    list_tasks = next(op for op in operations if isinstance(op, dict) and op["id"] == "listTasks")
    assert isinstance(list_tasks, dict)
    field_rights = list_tasks["fieldRights"]
    assert isinstance(field_rights, list)

    for field_right in field_rights:
        if isinstance(field_right, dict) and field_right["direction"] == "output":
            field_right["pointer"] = pointer

    return dataclasses.replace(contract, ir_view=ir_view)


def _with_two_output_params(contract: ApiContract) -> ApiContract:
    """`listTasks` with `/effort` and `/title` restricted to its output right, each with other params."""
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(contract.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    list_tasks = next(op for op in operations if isinstance(op, dict) and op["id"] == "listTasks")
    assert isinstance(list_tasks, dict)
    field_rights = list_tasks["fieldRights"]
    assert isinstance(field_rights, list)
    effort = next(right for right in field_rights if isinstance(right, dict) and right["direction"] == "output")
    assert isinstance(effort, dict)

    title = copy.deepcopy(effort)
    effort["params"] = {"allowed": ["owner"]}
    title["pointer"] = "/title"
    title["params"] = {"allowed": ["owner", "editor"]}
    field_rights.append(title)

    return dataclasses.replace(contract, ir_view=ir_view)


@dataclass
class _EditorDecider:
    """Allows a request whose params let an editor in; records each request."""

    asked: list[RequirementRequest] = field(default_factory=list)

    def decide(self, request: RequirementRequest, /) -> Decision:
        self.asked.append(request)
        allowed = (request.params or {}).get("allowed")

        if isinstance(allowed, list) and "editor" in allowed:
            return decision.Allowed()

        return decision.Denied(deny=ErrorCodeWithParams(code=_FORBIDDEN))


def test_two_output_members_of_one_right_with_other_params_are_decided_apart(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    contract = _with_two_output_params(tasks_contract)
    decider = _EditorDecider()
    response = contract.operation("listTasks")["responses"]
    assert isinstance(response, list)

    visible = asyncio.run(
        visible_output(
            _state(contract, "listTasks", None),
            AccessHooks(authenticate={}, deciders={"tasks.seeEffort": decider}, scope_resolvers={}),
            hook_caller,
            response[0],
            [{"taskId": "t1", "effort": 3, "title": "Write"}],
        )
    )

    assert visible == [{"taskId": "t1", "title": "Write"}]
    assert len(decider.asked) == 2


def test_an_output_pointer_names_its_member_unescaped(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    contract = _with_output_pointer(tasks_contract, "/effort~1hours~0max")

    visible = _list_tasks_output(
        contract, [{"taskId": "t1", "effort/hours~max": 3}], _Decider(allowed=frozenset()), hook_caller
    )

    assert visible == [{"taskId": "t1"}]


def test_a_holder_without_its_id_asks_the_decider_with_no_subject(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    decider = _Decider()

    visible = _list_tasks_output(tasks_contract, [{"effort": 3}], decider, hook_caller)

    assert visible == [{"effort": 3}]
    assert [request.subject for request in decider.asked] == [None]


def test_a_denied_input_member_is_refused_with_its_pointer(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    decider = _Decider(allowed=frozenset())
    state = _state(tasks_contract, "createTask", {"title": "Write", "effort": 3})

    with pytest.raises(ContractRefusal) as refused:
        asyncio.run(checked_input_fields(state, _hooks("roles", decider), hook_caller))

    assert refused.value.code == _FORBIDDEN
    assert refused.value.params == {"pointer": "/effort"}
    assert decider.asked[0].subject is not None
    assert decider.asked[0].subject.id == _CHANNEL


def test_an_allowed_or_absent_input_member_keeps_the_body(tasks_contract: ApiContract, hook_caller: HookCaller) -> None:
    decider = _Decider()
    sent = {"title": "Write", "effort": 3}

    kept = asyncio.run(
        checked_input_fields(_state(tasks_contract, "createTask", sent), _hooks("roles", decider), hook_caller)
    )
    without = asyncio.run(
        checked_input_fields(
            _state(tasks_contract, "createTask", {"title": "Write"}), _hooks("roles", decider), hook_caller
        )
    )

    assert kept == sent
    assert without == {"title": "Write"}
    assert len(decider.asked) == 1
