"""The per-request state of a boundary (ADR 0027 "Sync and async"): one mutable holder per api that step 1 sets on
the `HttpRequest`, never in module globals. It carries the operation the raw path matched, the decoded input, the
replies the boundary wrote, the operation the generated view admitted, and the exception a wrapped error handler or
the `got_request_exception` receiver recorded."""

from dataclasses import dataclass, field
from typing import Final

from django.http import HttpRequest

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.reply_verdict import AuthoredReplies

_HOLDERS_ATTRIBUTE: Final = "seampact_boundaries"


@dataclass(slots=True, repr=False)
class BoundaryState:
    contract: ApiContract
    operation_id: str
    raw_parameters: dict[str, str]
    decoded: DecodedInput
    authored: AuthoredReplies = field(default_factory=AuthoredReplies)
    admitted_operation: str | None = None
    recorded: BaseException | None = None

    def __repr__(self) -> str:
        return f"BoundaryState({self.contract.api}.{self.operation_id}, [redacted])"


def attach(request: HttpRequest, state: BoundaryState) -> None:
    holders = _holders(request)
    holders[state.contract.api] = state


def state_of(request: HttpRequest, api: str) -> BoundaryState | None:
    return _holders(request).get(api)


def record_exception(request: HttpRequest, exception: BaseException) -> None:
    """Keeps the first exception behind a reply, for every api whose boundary admitted the request."""
    for state in _holders(request).values():
        if state.recorded is None:
            state.recorded = exception


def _holders(request: HttpRequest) -> dict[str, BoundaryState]:
    holders = getattr(request, _HOLDERS_ATTRIBUTE, None)

    if isinstance(holders, dict):
        return holders

    created: dict[str, BoundaryState] = {}
    setattr(request, _HOLDERS_ATTRIBUTE, created)

    return created
