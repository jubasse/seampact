"""The decide request of a right or rule carries the use site's params as the generated params class, the same on
fastapi, drf and ninja, which share this access step; params the class refuses fail the boundary."""

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
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import IrMap, ir_maps
from seampact.codegen.runtime.requirement_params import requirement_params
from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    RequestView,
    RequirementKind,
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


def test_the_decide_request_of_a_right_carries_its_params_as_the_generated_params_model(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    roles = next(request for request in _asked_requests(tasks_contract, hook_caller) if request.name == _ROLES_RIGHT)

    assert isinstance(roles.params, pydantic.BaseModel)
    assert type(roles.params).__name__ == "RolesParams"
    assert roles.params.model_dump(mode="json") == {"allowed": ["owner", "editor"]}


def _use_site(contract: ApiContract, operation_id: str) -> IrMap:
    return ir_maps(contract.operation(operation_id), "requires")[0]


def test_the_decide_request_of_a_rule_carries_its_params_as_the_generated_params_model(
    tasks_contract: ApiContract,
) -> None:
    params = requirement_params(
        tasks_contract, RequirementKind.RULE, "recentAuth", _use_site(tasks_contract, "purgeTask")
    )

    assert isinstance(params, pydantic.BaseModel)
    assert type(params).__name__ == "RecentAuthParams"
    assert params.model_dump(mode="json") == {"intent": "purge_task"}


@pytest.mark.parametrize(
    ("use_site", "named"),
    [
        ({"params": {"allowed": ["owner"], "quorum": 2}}, "/quorum"),
        ({"params": {"allowed": []}}, "roles"),
        ({"params": {"allowed": "owner"}}, "roles"),
    ],
)
def test_use_site_params_the_params_class_refuses_fail_the_boundary(
    tasks_contract: ApiContract, use_site: IrMap, named: str
) -> None:
    with pytest.raises(BoundaryFailureError, match=named):
        requirement_params(tasks_contract, RequirementKind.RIGHT, _ROLES_RIGHT, use_site)
