"""The per-request state of one api's boundary, kept in the ASGI scope under one seampact key, never in module
globals (ADR 0026 "Sync and async"): what step 1 matched and decoded, what the access dependency admitted, the typed
input, the replies the boundary wrote, and an `HTTPException` the app's handlers rendered."""

from collections.abc import MutableMapping
from dataclasses import dataclass, field
from typing import Final

from starlette.exceptions import HTTPException

from seampact.codegen.runtime.access_steps import AccessState
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.codegen.runtime.reply_verdict import AuthoredReplies
from seampact.hooks import UnexpectedErrorListener

SCOPE_KEY: Final = "seampact"


@dataclass(slots=True, kw_only=True)
class RequestState:
    """`operation_id` the operation the raw path matched; `admitted` once steps 2 to 5 passed; `typed_request` the
    request the input dependency built; `http_exception` the last `HTTPException` the app's handlers rendered."""

    contract: ApiContract
    operation_id: str
    method: str
    target: RawTarget
    raw_parameters: dict[str, str]
    decoded: DecodedInput
    authored: AuthoredReplies = field(default_factory=AuthoredReplies)
    access: AccessState | None = None
    admitted: bool = False
    typed_request: object | None = None
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
