"""A throttle rule's decider gets the bucket keyed by the declared principal member, and its denial is the 429 with
the delay in `Retry-After`."""

import asyncio
from dataclasses import dataclass, field

import pytest

from seampact.codegen.runtime.access_steps import (
    AccessHooks,
    AccessState,
    CredentialsType,
    HookCaller,
    run_access_steps,
)
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.digests import hex_of
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.replies import error_reply
from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    ErrorCodeWithParams,
    RequestView,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    ScopeResolution,
    authenticate_result,
    decision,
    scope_resolution,
)

_CREATE_TASK = "createTask"
_CHANNEL = "8a6e0804-2bd0-4672-b79d-d97027f9071a"
_RATE_LIMITED = "api.rate_limited"


@dataclass(frozen=True, slots=True)
class _Principal:
    user_id: str


@dataclass
class _Throttle:
    asked: list[RequirementRequest] = field(default_factory=list)

    def decide(self, request: RequirementRequest, /) -> Decision:
        self.asked.append(request)
        return decision.Denied(deny=ErrorCodeWithParams(code=_RATE_LIMITED, params={"retryAfterMs": 1500}))


class _Users:
    def authenticate(self, request: AuthenticateRequest, /) -> AuthenticateResult:
        return authenticate_result.Authenticated(principal=_Principal("alice"))


class _Channels:
    def resolve_scope(self, request: ResolveScopeRequest, /) -> ScopeResolution:
        return scope_resolution.Resolved(resolved=ResolvedScope(scope="channel", id=_CHANNEL))


def test_a_throttled_write_is_refused_with_the_bucket_of_its_caller(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    throttle = _Throttle()
    state = AccessState(
        contract=tasks_contract,
        operation_id=_CREATE_TASK,
        credentials_types={"user": CredentialsType(build=dict, attributes={"bearer": "bearer"})},
        raw_parameters={"channelId": _CHANNEL},
        request=RequestView(
            method="POST", path=f"/v1/channels/{_CHANNEL}/tasks", headers={"authorization": ("Bearer t1",)}
        ),
        body={"title": "Write"},
    )
    hooks = AccessHooks(
        authenticate={"user": _Users()}, deciders={"throttle": throttle}, scope_resolvers={"channel": _Channels()}
    )

    with pytest.raises(ContractRefusal) as refused:
        asyncio.run(run_access_steps(state, hooks, hook_caller))

    bucket = throttle.asked[0].bucket
    assert bucket is not None
    assert bucket.key == hex_of(["tasks", "write", ["alice"]])
    assert (bucket.limit, bucket.window_ms) == (60, 60000)
    assert refused.value.code == _RATE_LIMITED


def test_the_429_carries_the_delay_in_whole_seconds(tasks_contract: ApiContract) -> None:
    reply = error_reply(tasks_contract, _CREATE_TASK, _RATE_LIMITED, {"retryAfterMs": 1500})

    assert reply.status == 429
    assert reply.header("retry-after") == "2"
