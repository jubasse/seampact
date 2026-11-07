"""Idempotency on Django (ADR 0012 "Target obligations"): the store the api's configuration builds, the claim a
generated view takes before its handler runs, and the record the boundary settles with the reply that went out, so
a reply written by an exception handler or the api's 500 settles it too."""

from django.http import HttpRequest, HttpResponse, HttpResponseBase

from seampact.codegen.runtime.idempotency import (
    IdempotencyClaimed,
    IdempotencyReplayed,
    IdempotencyStoreFailure,
    abandon_idempotency,
    begin_idempotency,
    settle_idempotency,
)
from seampact.codegen.runtime.replies import Reply
from seampact.codegen.runtime.sync_driver import call_without_suspension, run_without_suspension
from seampact.django.runtime.api_configuration import configuration_of
from seampact.django.runtime.contract_replies import logger, report_unexpected
from seampact.django.runtime.request_state import BoundaryState, HeldClaim


class ReplayedReplyError(Exception):
    """The stored reply of an earlier request with the same key: the view raises it so its handler never runs, and
    the exception handler writes the reply. Neither its message nor its repr shows the reply."""

    def __init__(self, replayed: IdempotencyReplayed) -> None:
        super().__init__("seampact: an idempotent request replayed")
        self.replayed = replayed

    def __repr__(self) -> str:
        return f"{type(self).__qualname__}([redacted])"


def claim_idempotency(request: HttpRequest, state: BoundaryState, principal: object | None) -> None:
    """Claims the request's key before the handler runs; the boundary settles the claim with the reply.

    Raises `ReplayedReplyError` for a stored reply, `ContractRefusal` for a running or reused key, and
    `BoundaryFailureError` for a missing or broken store."""
    contract = state.contract
    store = configuration_of(contract.api).idempotency_store(request)
    started = run_without_suspension(
        begin_idempotency(contract, state.operation_id, principal, state.decoded, store, call_without_suspension)
    )

    if isinstance(started, IdempotencyReplayed):
        raise ReplayedReplyError(started)

    if isinstance(started, IdempotencyClaimed) and store is not None:
        state.held_claim = HeldClaim(started, store)


def settle_claim(request: HttpRequest, state: BoundaryState, response: HttpResponseBase) -> None:
    """Completes the held record with the reply that goes out, or abandons it when the reply is a stream, whose body
    the boundary never holds."""
    held = _taken_claim(state)

    if held is None:
        return

    if not isinstance(response, HttpResponse) or response.streaming:
        logger(state.contract.api).warning(
            "seampact: operation %s answered a stream, which the idempotency store cannot keep; a retry runs again",
            state.operation_id,
        )
        _report(request, state, _abandoned(held))
        return

    headers = tuple((name.lower(), value) for name, value in response.items())
    reply = Reply(response.status_code, headers, response.content)
    failure = run_without_suspension(
        settle_idempotency(state.contract, state.operation_id, held.claimed, reply, held.store, call_without_suspension)
    )
    _report(request, state, failure)


def abandon_claim(request: HttpRequest, state: BoundaryState) -> None:
    """Releases the held record of a request that failed before its reply."""
    held = _taken_claim(state)

    if held is not None:
        _report(request, state, _abandoned(held))


def _taken_claim(state: BoundaryState) -> HeldClaim | None:
    held = state.held_claim
    state.held_claim = None

    return held


def _abandoned(held: HeldClaim) -> IdempotencyStoreFailure | None:
    return run_without_suspension(abandon_idempotency(held.claimed, held.store, call_without_suspension))


def _report(request: HttpRequest, state: BoundaryState, failure: IdempotencyStoreFailure | None) -> None:
    if failure is not None:
        report_unexpected(request, state.contract, state.operation_id, failure.reason, failure.cause)
