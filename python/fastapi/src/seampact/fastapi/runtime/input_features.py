"""The operation features around steps 6 to 8 of one contract request, in the order every target runs them: the sent
version first, so a missing `If-Match` answers `preconditionRequired` and never `schemaInvalid`; the typed input as
sent; the paged list's limit filled in and the input field rights, which leave out or refuse a restricted member; the
deadline; then the idempotency claim, whose stored reply is raised as `ReplayedReply` so the handler never runs."""

import dataclasses
from datetime import UTC, datetime
from typing import Final

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.deadline import request_deadline
from seampact.codegen.runtime.field_rights import checked_input_fields
from seampact.codegen.runtime.idempotency import IdempotencyClaimed, IdempotencyReplayed, begin_idempotency
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.ir_view import ir_map, ir_string
from seampact.codegen.runtime.page_reply import filled_page_query
from seampact.codegen.runtime.replies import Reply
from seampact.codegen.runtime.version_token import sent_version
from seampact.fastapi.runtime.contract_input import InputBuilder
from seampact.fastapi.runtime.handler_call import call_handler
from seampact.fastapi.runtime.request_state import RequestState

_HEADER_SOURCE: Final = "header"


class ReplayedReply(Exception):  # noqa: N818 - a stored reply the exception map writes, not an error
    """The stored reply of an earlier request with the same idempotency key; its repr hides the reply."""

    def __init__(self, api: str, replayed: IdempotencyReplayed) -> None:
        super().__init__(f"seampact: the '{api}' api replays a stored reply")
        self.api = api
        self.replayed = replayed

    @property
    def reply(self) -> Reply:
        return self.replayed.reply

    def __repr__(self) -> str:
        return f"ReplayedReply(api={self.api!r}, reply=[redacted])"

    def __str__(self) -> str:
        return repr(self)


async def featured_input(state: RequestState, access: AccessState, hooks: AccessHooks, builder: InputBuilder) -> object:
    """The typed request the handler receives.

    Raises `ContractRefusal` for a refused input, `ReplayedReply` for a stored reply, and `BoundaryFailureError` for a
    fault of the boundary (a missing idempotency store, a hook's undeclared answer)."""
    contract = state.contract
    operation_id = state.operation_id
    sent = _with_sent_version(contract, operation_id, state.decoded)
    typed = builder.build(sent, access, state.target.query)
    filled_query = filled_page_query(contract, operation_id, sent.query)
    checked_body = await checked_input_fields(access, hooks, call_handler)
    decoded = dataclasses.replace(sent, query=filled_query, body=checked_body)

    # The input as sent was checked; the handler receives the filled limit and the body its field rights leave.
    if filled_query != sent.query or checked_body != sent.body:
        typed = builder.build(decoded, access, state.target.query)

    request_deadline(contract, operation_id, decoded, datetime.now(UTC))
    state.input_query = decoded.query
    started = await begin_idempotency(
        contract, operation_id, access.principal, decoded, state.idempotency_store, call_handler
    )

    if isinstance(started, IdempotencyReplayed):
        raise ReplayedReply(contract.api, started)

    if isinstance(started, IdempotencyClaimed):
        state.idempotency = started

    return typed


def _with_sent_version(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> DecodedInput:
    """The decoded input with a header version unquoted (`If-Match: "7"` reads `7`), as the handler compares it."""
    concurrency = ir_map(contract.operation(operation_id), "concurrency")

    if not concurrency:
        return decoded

    version = sent_version(contract, operation_id, decoded)
    source = ir_map(concurrency, "version")

    if ir_string(source, "in") != _HEADER_SOURCE:
        return decoded

    headers = {**decoded.headers, ir_string(source, "name") or "": version}

    return dataclasses.replace(decoded, headers=headers)
