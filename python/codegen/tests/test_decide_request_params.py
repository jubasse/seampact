"""The decide request of a right carries the right's params typed with its params schema, the same on fastapi, drf and
ninja, which share this access step."""

import asyncio
from dataclasses import dataclass, field

import pydantic
import pytest

from seampact.codegen.runtime.access_steps import (
    AccessHooks,
    AccessState,
    CredentialsType,
    HookCaller,
    run_access_steps,
)
from seampact.codegen.runtime.contract import ApiContract
from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
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
_ROLES_RIGHT = "roles"


@dataclass(frozen=True, slots=True)
class _Principal:
    user_id: str


@dataclass
class _AllowingDecider:
    asked: list[RequirementRequest] = field(default_factory=list)

    def decide(self, request: RequirementRequest, /) -> Decision:
        self.asked.append(request)
        return decision.Allowed()


class _Users:
    def authenticate(self, request: AuthenticateRequest, /) -> AuthenticateResult:
        return authenticate_result.Authenticated(principal=_Principal("alice"))


class _Channels:
    def resolve_scope(self, request: ResolveScopeRequest, /) -> ScopeResolution:
        return scope_resolution.Resolved(resolved=ResolvedScope(scope="channel", id=_CHANNEL))


def _asked_requests(contract: ApiContract, call: HookCaller) -> list[RequirementRequest]:
    decider = _AllowingDecider()
    state = AccessState(
        contract=contract,
        operation_id=_CREATE_TASK,
        credentials_types={"user": CredentialsType(build=dict, attributes={"bearer": "bearer"})},
        raw_parameters={"channelId": _CHANNEL},
        request=RequestView(
            method="POST", path=f"/v1/channels/{_CHANNEL}/tasks", headers={"authorization": ("Bearer t1",)}
        ),
        body={"title": "Write"},
    )
    hooks = AccessHooks(
        authenticate={"user": _Users()},
        deciders={"throttle": decider, _ROLES_RIGHT: decider},
        scope_resolvers={"channel": _Channels()},
    )

    asyncio.run(run_access_steps(state, hooks, call))

    return decider.asked


def test_the_decide_request_of_a_right_names_the_right_and_its_use_site_params(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    roles = [request for request in _asked_requests(tasks_contract, hook_caller) if request.name == _ROLES_RIGHT]

    assert len(roles) == 1
    assert roles[0].params is not None


@pytest.mark.xfail(
    strict=True,
    reason="the decide request types params as Mapping[str, object] for every right, not the right's params schema",
)
def test_the_decide_request_of_a_right_carries_the_rights_declared_params_type(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    roles = next(request for request in _asked_requests(tasks_contract, hook_caller) if request.name == _ROLES_RIGHT)
    # Read through `object`: the declared Mapping type is the defect this test names.
    params: object = roles.params

    assert isinstance(params, pydantic.BaseModel)
    assert type(params).__name__ == "RolesParams"
