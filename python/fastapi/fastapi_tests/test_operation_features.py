"""The operation features around the input steps of the FastAPI placement: a write versioned by `If-Match` answers
`preconditionRequired` (428) for a missing header before the header check could call it `schemaInvalid`, the header
version reaches the handler unquoted, the boot check names a missing idempotency store, and a page reads its facts
through its generated fact table and fails closed on a projection that is not a list."""

import asyncio
import copy
import dataclasses
import importlib
from collections.abc import Callable, Mapping
from typing import ClassVar, Final

import fastapi
import pydantic
import pytest

from seampact.codegen.runtime import handler_reply
from seampact.codegen.runtime.access_steps import AccessHooks, AccessState
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.handler_reply import ReplyContext, result_reply
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.ir_view import IrJson
from seampact.codegen.runtime.pydantic.contract_input import InputBuilder
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.codegen.runtime.replies import Reply
from seampact.fastapi.runtime import ApiBinding, OperationTypes
from seampact.fastapi.runtime.boot_check import boot_problems
from seampact.fastapi.runtime.handler_call import call_handler
from seampact.fastapi.runtime.input_features import featured_input
from seampact.fastapi.runtime.request_state import RequestState
from seampact.hooks import RequestView

_GOLDEN_API: Final = "fastapi_tests.golden.reference.tasks"
_ARCHIVE_TASK: Final = "archiveTask"
_IF_MATCH: Final = "If-Match"
_PRECONDITION_FAILED: Final = "api.precondition_failed"
_PRECONDITION_REQUIRED: Final = "api.precondition_required"
_LIST_TASKS: Final = "listTasks"
_NEXT_CURSOR: Final = "cursor-of-the-next-page"


class _ArchiveHeaders(pydantic.BaseModel):
    model_config = pydantic.ConfigDict(strict=True, frozen=True, extra="forbid")

    if_match: str


@dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class _ArchiveInput:
    headers: _ArchiveHeaders


@dataclasses.dataclass(frozen=True, slots=True)
class _ArchiveRequest:
    input: _ArchiveInput


class _ArchiveErrors:
    pass


def _if_match_contract() -> ApiContract:
    """`archiveTask` versioned by a required `If-Match` header parameter, with the codes the compiler derives for it."""
    golden = importlib.import_module(f"{_GOLDEN_API}.contract").CONTRACT
    assert isinstance(golden, ApiContract)
    ir_view: dict[str, IrJson] = copy.deepcopy(dict(golden.ir_view))
    operations = ir_view["operations"]
    assert isinstance(operations, list)
    archive = next(op for op in operations if isinstance(op, dict) and op["id"] == _ARCHIVE_TASK)
    assert isinstance(archive, dict)
    archive["concurrency"] = {"field": "version", "version": {"in": "header", "name": _IF_MATCH}}
    archive.pop("fieldRights", None)
    archive.pop("idempotency", None)
    errors = archive["errors"]
    assert isinstance(errors, list)
    errors += [
        {"code": _PRECONDITION_FAILED, "roles": [{"role": "preconditionFailed"}]},
        {"code": _PRECONDITION_REQUIRED, "roles": [{"role": "preconditionRequired"}]},
    ]
    operation_members = {**golden.operation_members, _ARCHIVE_TASK: {"header": {_IF_MATCH: "if_match"}}}

    return dataclasses.replace(golden, ir_view=ir_view, operation_members=operation_members)


def _archive(headers: dict[str, object]) -> object:
    contract = _if_match_contract()
    decoded = DecodedInput({}, {}, headers, None, None)
    request = RequestView(method="POST", path="/v1/archive", headers={}, client_address=None)
    access = AccessState(
        contract=contract,
        operation_id=_ARCHIVE_TASK,
        credentials_types={},
        raw_parameters={},
        request=request,
        body=None,
    )
    state = RequestState(
        contract=contract,
        operation_id=_ARCHIVE_TASK,
        method="POST",
        target=RawTarget(path="/v1/archive", query="", raw=True),
        raw_parameters={},
        decoded=decoded,
    )
    types = OperationTypes(request=_ArchiveRequest, responses=(), errors=_ArchiveErrors)
    builder = InputBuilder(contract, _ARCHIVE_TASK, types)
    hooks = AccessHooks(authenticate={}, deciders={}, scope_resolvers={})

    return asyncio.run(featured_input(state, access, hooks, builder))


@pytest.mark.parametrize("headers", [{}, {_IF_MATCH: ""}, {_IF_MATCH: "*"}])
def test_a_write_without_its_if_match_version_answers_precondition_required(headers: dict[str, object]) -> None:
    with pytest.raises(ContractRefusal) as refused:
        _archive(headers)

    assert refused.value.code == _PRECONDITION_REQUIRED


def test_a_listed_if_match_tag_answers_precondition_failed() -> None:
    with pytest.raises(ContractRefusal) as refused:
        _archive({_IF_MATCH: '"1", "2"'})

    assert refused.value.code == _PRECONDITION_FAILED


@pytest.mark.parametrize("sent", ['"7"', 'W/"7"'])
def test_the_handler_reads_the_if_match_version_unquoted(sent: str) -> None:
    typed = _archive({_IF_MATCH: sent})

    assert isinstance(typed, _ArchiveRequest)
    assert typed.input.headers.if_match == "7"


def test_the_boot_check_names_a_missing_idempotency_store() -> None:
    placement = importlib.import_module(f"{_GOLDEN_API}.fastapi")
    bind: Callable[..., None] = placement.bind_tasks
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
    )
    app = fastapi.FastAPI()
    bind(app, handlers=handlers)
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    problems = boot_problems(binding)

    store_problems = [problem for problem in problems if problem.startswith("no idempotency store for the operations")]

    assert len(store_problems) == 1
    assert "archiveTask" in store_problems[0]
    assert "`idempotency_store=` of bind_tasks()" in store_problems[0]


@dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class _RenamedFactPage:
    """A page whose attribute for `nextCursor` is not its camel-case inverse: only its fact table names the fact."""

    _FACTS: ClassVar[Mapping[str, str]] = {"items": "items", "following": "nextCursor"}

    items: list[object]
    following: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class _ListTasksSuccess:
    body: _RenamedFactPage


class _ListTasksErrors:
    pass


def _list_tasks_reply(page: _RenamedFactPage) -> Reply:
    golden = importlib.import_module(f"{_GOLDEN_API}.contract").CONTRACT
    assert isinstance(golden, ApiContract)
    request = RequestView(method="GET", path="/v1/tasks", headers={}, client_address=None)
    access = AccessState(
        contract=golden,
        operation_id=_LIST_TASKS,
        credentials_types={},
        raw_parameters={},
        request=request,
        body=None,
    )
    context = ReplyContext(
        access=access,
        hooks=AccessHooks(authenticate={}, deciders={}, scope_resolvers={}),
        call=call_handler,
        query={"limit": 20},
        raw_query="",
        path="/v1/tasks",
        if_none_match=None,
        public_origin=None,
    )
    types = OperationTypes(request=object, responses=((200, _ListTasksSuccess),), errors=_ListTasksErrors)

    return asyncio.run(result_reply(golden, _LIST_TASKS, types, _ListTasksSuccess(page), context))


def test_a_page_reads_its_facts_through_its_generated_fact_table() -> None:
    reply = _list_tasks_reply(_RenamedFactPage(items=[], following=_NEXT_CURSOR))

    assert _NEXT_CURSOR in repr(reply.headers) + reply.body.decode()


def test_a_page_projection_that_is_not_a_list_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def projected_to_a_mapping(*_arguments: object) -> object:
        return {"items": []}

    monkeypatch.setattr(handler_reply, "visible_output", projected_to_a_mapping)

    with pytest.raises(BoundaryFailureError, match=_LIST_TASKS):
        _list_tasks_reply(_RenamedFactPage(items=[]))
