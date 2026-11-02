"""The idempotency claim after the shared input features of one contract request (the sent version, the typed input,
the filled page limit, the input field rights, the deadline): its stored reply is raised as `ReplayedReply` so the
handler never runs."""

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState
from seampact.codegen.runtime.idempotency import IdempotencyClaimed, IdempotencyReplayed, begin_idempotency
from seampact.codegen.runtime.pydantic.checked_input import checked_input
from seampact.codegen.runtime.pydantic.contract_input import InputBuilder
from seampact.codegen.runtime.replies import Reply
from seampact.fastapi.runtime.handler_call import call_handler
from seampact.fastapi.runtime.request_state import RequestState


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
    checked = await checked_input(
        contract, operation_id, state.decoded, state.target.query, access, hooks, builder, call_handler
    )
    state.input_query = checked.decoded.query
    started = await begin_idempotency(
        contract, operation_id, access.principal, checked.decoded, state.idempotency_store, call_handler
    )

    if isinstance(started, IdempotencyReplayed):
        raise ReplayedReply(contract.api, started)

    if isinstance(started, IdempotencyClaimed):
        state.idempotency = started

    return checked.typed
