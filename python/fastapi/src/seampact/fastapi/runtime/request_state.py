"""The per-request state of one api's boundary, kept in the ASGI scope under one seampact key, never in module
globals (ADR 0026 "Sync and async"): what step 1 matched and decoded, what the access dependency admitted, the typed
input, the hooks and the idempotency claim of the request, the replies the boundary wrote, and an `HTTPException` the
app's handlers rendered."""

from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import ClassVar, Final

from starlette.exceptions import HTTPException

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.idempotency import IdempotencyClaimed
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.codegen.runtime.reply_verdict import AuthoredReplies
from seampact.hooks import IdempotencyStore, UnexpectedErrorListener
from seampact.hooks._redaction import RedactedRepr

SCOPE_KEY: Final = "seampact"


@dataclass(slots=True, kw_only=True, repr=False)
class RequestState(RedactedRepr):
    """`operation_id` the operation the raw path matched; `admitted` once steps 2 to 5 passed; `hooks` and
    `idempotency_store` what the access dependency resolved; `typed_request` the request the input dependency built,
    with `input_query` the query it read; `idempotency` the key this request claimed; `http_exception` the last
    `HTTPException` the app's handlers rendered. `repr` shows none of the request's values."""

    _REDACTED_FIELDS: ClassVar[frozenset[str]] = frozenset({"target", "raw_parameters", "typed_request", "input_query"})

    contract: ApiContract
    operation_id: str
    method: str
    target: RawTarget
    raw_parameters: dict[str, str]
    decoded: DecodedInput
    authored: AuthoredReplies = field(default_factory=AuthoredReplies)
    access: AccessState | None = None
    admitted: bool = False
    hooks: AccessHooks | None = None
    idempotency_store: IdempotencyStore | None = None
    typed_request: object | None = None
    input_query: dict[str, object] = field(default_factory=dict)
    idempotency: IdempotencyClaimed | None = None
    http_exception: HTTPException | None = None
    listener: UnexpectedErrorListener | None = None


def scope_states(scope: MutableMapping[str, object]) -> dict[str, RequestState]:
    """The states of every api's boundary in this request, created empty on first use."""
    held = scope.get(SCOPE_KEY)

    if isinstance(held, dict):
        return held

    states: dict[str, RequestState] = {}
    scope[SCOPE_KEY] = states

    return states


def state_of(scope: MutableMapping[str, object], api: str) -> RequestState | None:
    """The state of `api`'s boundary, None when the request is not one of its contract requests."""
    held = scope.get(SCOPE_KEY)
    state = held.get(api) if isinstance(held, dict) else None

    return state if isinstance(state, RequestState) else None
