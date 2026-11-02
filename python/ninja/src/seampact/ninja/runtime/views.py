"""The body of a generated Ninja view (ADR 0027 "Ninja"): Ninja ran the operation's `auth=` and throttles; the view
checks the boundary's mark and the chosen route, runs steps 2 to 5, validates the boundary's decoded input with the
generated Pydantic models (steps 6 to 8 and the operation features), claims the idempotency key, calls the handler
and writes its result with the boundary's own encoding. A contract refusal, a contract exception, a replayed reply and
a boundary failure are answered here; any other exception goes on to Ninja, whose wrapped `on_exception` records it
for the boundary. Sync views drive the shared steps without suspension; async views await them, a plain `def` hook
or handler method running through `sync_to_async`."""

from collections.abc import Awaitable, Callable
from typing import Final

from asgiref.sync import sync_to_async
from django.http import HttpRequest, HttpResponse

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState, HookCaller, headers_view, run_access_steps
from seampact.codegen.runtime.contract import NOT_FOUND_ROLE
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.handler_call import call_handler_in
from seampact.codegen.runtime.handler_reply import ReplyContext, code_reply, result_reply
from seampact.codegen.runtime.input_decoding import role_refusal
from seampact.codegen.runtime.public_origin import configured_origin
from seampact.codegen.runtime.pydantic.checked_input import CheckedInput, checked_input
from seampact.codegen.runtime.replies import error_reply
from seampact.codegen.runtime.sync_driver import call_without_suspension, run_without_suspension
from seampact.django.runtime.contract_replies import django_response, unexpected_response
from seampact.django.runtime.idempotency_records import ReplayedReplyError, claim_idempotency
from seampact.django.runtime.request_state import BoundaryState, raw_headers, state_of
from seampact.hooks import RequestView
from seampact.ninja.runtime.binding import ApiBinding, BoundOperation, binding_of
from seampact.ninja.runtime.placement import ApiPlacement

_CROSSED_VIEW: Final = "an exception crossed the view"
_IF_NONE_MATCH: Final = "If-None-Match"
_QUERY_STRING: Final = "QUERY_STRING"


def serve_operation(request: HttpRequest, placement: ApiPlacement, operation_id: str) -> HttpResponse:
    """The body of a sync contract view."""
    binding = _bound(placement)

    try:
        return _served(request, binding, operation_id)
    except (ContractRefusal, BoundaryFailureError, ReplayedReplyError, placement.error_base) as answered:
        return _answer(request, binding, operation_id, answered)


async def serve_operation_async(request: HttpRequest, placement: ApiPlacement, operation_id: str) -> HttpResponse:
    """The body of an async contract view."""
    binding = _bound(placement)

    try:
        return await _served_async(request, binding, operation_id)
    except (ContractRefusal, BoundaryFailureError, ReplayedReplyError, placement.error_base) as answered:
        return await sync_to_async(_answer)(request, binding, operation_id, answered)


def async_handler_error(method: Callable[..., object], result: Awaitable[object]) -> TypeError:
    """The error a sync view raises when a handler method returned an awaitable; the boot check refuses an `async def`
    method first. A coroutine is closed, so Python never warns that it was not awaited."""
    close = getattr(result, "close", None)

    if callable(close):
        close()

    return TypeError(
        f"seampact: the handler method {getattr(method, '__qualname__', method)} returned an awaitable, and the api's "
        "views are sync; make it a plain `def` returning its result, or generate with the target option "
        "`views: async`."
    )


async def call_handler_async[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
    """Calls a handler or hook method from an async view: an `async def` method is awaited, a plain `def` runs
    through `sync_to_async`."""
    return await call_handler_in(method, argument, _in_thread)


async def _in_thread[A, R](method: Callable[[A], R], argument: A) -> R:
    return await sync_to_async(method)(argument)


def _served(request: HttpRequest, binding: ApiBinding, operation_id: str) -> HttpResponse:
    state, bound = _admitted_state(request, binding, operation_id)
    hooks = binding.access_hooks(request)
    access = _access_state(request, binding, state, operation_id)
    run_without_suspension(run_access_steps(access, hooks, call_without_suspension))
    state.admitted_operation = operation_id
    checked = run_without_suspension(_checked(request, state, bound, access, hooks, call_without_suspension))
    claim_idempotency(request, state, access.principal)
    endpoints = _handlers(binding, bound)(request)
    result = bound.call(endpoints, checked.typed)
    context = _reply_context(request, binding, state, checked, access, hooks, call_without_suspension)
    reply = run_without_suspension(result_reply(binding.contract, operation_id, bound.types, result, context))

    return django_response(request, binding.contract, reply)


async def _served_async(request: HttpRequest, binding: ApiBinding, operation_id: str) -> HttpResponse:
    """The factories and the idempotency store run in Django's sync thread, as an ORM-backed store needs."""
    state, bound = _admitted_state(request, binding, operation_id)
    hooks = await sync_to_async(binding.access_hooks)(request)
    access = _access_state(request, binding, state, operation_id)
    await run_access_steps(access, hooks, call_handler_async)
    state.admitted_operation = operation_id
    checked = await _checked(request, state, bound, access, hooks, call_handler_async)
    await sync_to_async(claim_idempotency)(request, state, access.principal)
    endpoints = await sync_to_async(_handlers(binding, bound))(request)
    result: object = bound.call(endpoints, checked.typed)
    awaited = await result if isinstance(result, Awaitable) else result
    context = _reply_context(request, binding, state, checked, access, hooks, call_handler_async)
    reply = await result_reply(binding.contract, operation_id, bound.types, awaited, context)

    return django_response(request, binding.contract, reply)


def _bound(placement: ApiPlacement) -> ApiBinding:
    binding = binding_of(placement.api)

    if binding is None:
        raise BoundaryFailureError(
            f"seampact: a contract view of api '{placement.api}' ran before bind_{placement.api}(); call it in the "
            "module that builds the NinjaAPI the root URLconf includes."
        )

    return binding


def _admitted_state(
    request: HttpRequest, binding: ApiBinding, operation_id: str
) -> tuple[BoundaryState, BoundOperation]:
    """The boundary's state of this request: without its mark the view fails closed before any input is read; a raw
    path that matched another operation than the route Ninja chose answers that path's 404."""
    contract = binding.contract
    state = state_of(request, contract.api)

    if state is None or state.contract is not contract:
        raise BoundaryFailureError(
            f"seampact: the view of operation '{operation_id}' of api '{contract.api}' was reached without the "
            "boundary's mark; list the api's boundary first in MIDDLEWARE, and test through the test Client."
        )

    if state.operation_id != operation_id:
        raise role_refusal(contract, state.operation_id, NOT_FOUND_ROLE)

    return state, binding.operations[operation_id]


def _access_state(request: HttpRequest, binding: ApiBinding, state: BoundaryState, operation_id: str) -> AccessState:
    return AccessState(
        contract=binding.contract,
        operation_id=operation_id,
        credentials_types=binding.placement.credentials,
        raw_parameters=state.raw_parameters,
        request=RequestView(
            method=request.method or "",
            path=request.path,
            headers=headers_view(raw_headers(request)),
            client_address=request.META.get("REMOTE_ADDR"),
        ),
        body=state.decoded.body,
        raw_body=state.decoded.raw_body,
    )


async def _checked(
    request: HttpRequest,
    state: BoundaryState,
    bound: BoundOperation,
    access: AccessState,
    hooks: AccessHooks,
    call: HookCaller,
) -> CheckedInput:
    raw_query = str(request.META.get(_QUERY_STRING, ""))

    return await checked_input(
        state.contract, state.operation_id, state.decoded, raw_query, access, hooks, bound.inputs, call
    )


def _reply_context(
    request: HttpRequest,
    binding: ApiBinding,
    state: BoundaryState,
    checked: CheckedInput,
    access: AccessState,
    hooks: AccessHooks,
    call: HookCaller,
) -> ReplyContext:
    return ReplyContext(
        access=access,
        hooks=hooks,
        call=call,
        query=checked.decoded.query,
        raw_query=str(request.META.get(_QUERY_STRING, "")),
        path=state.request_path,
        if_none_match=request.headers.get(_IF_NONE_MATCH),
        public_origin=configured_origin(binding.contract, binding.settings.public_origin),
    )


def _handlers(binding: ApiBinding, bound: BoundOperation) -> Callable[[HttpRequest], object]:
    if bound.handlers is None:
        raise BoundaryFailureError(
            f"seampact: the '{binding.placement.api}' api has no handler factory for operation "
            f"'{bound.route.operation_id}'; pass one in the handlers of bind_{binding.placement.api}()."
        )

    return bound.handlers


def _answer(request: HttpRequest, binding: ApiBinding, operation_id: str, answered: Exception) -> HttpResponse:
    """The contract reply of an exception the view answers itself; a fault answering it is the api's 500."""
    contract = binding.contract
    state = state_of(request, contract.api)

    if state is None or isinstance(answered, BoundaryFailureError):
        return unexpected_response(request, contract, None if state is None else operation_id, _CROSSED_VIEW, answered)

    if isinstance(answered, ReplayedReplyError):
        return django_response(request, contract, answered.replayed.reply)

    try:
        if isinstance(answered, ContractRefusal):
            reply = error_reply(contract, state.operation_id, answered.code, answered.params)
        else:
            reply = code_reply(contract, operation_id, getattr(answered, "CODE", ""), getattr(answered, "params", None))
    except BoundaryFailureError as failure:
        return unexpected_response(request, contract, operation_id, f"answering it failed: {failure}", answered)

    return django_response(request, contract, reply)
