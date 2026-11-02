"""A signed route's signature reaches the identity's hook parsed from its header, over the raw body as received, and
the principal members the idempotency partition and the buckets read are the declared ones only."""

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
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.principal_members import principal_members
from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    RequestView,
    SignatureEncoding,
    SignedTemplateRequest,
    authenticate_result,
)

_PAYMENTS = "payments"
_RAW_BODY = b'{"type":"payment.succeeded"}'


@dataclass
class _Authenticator:
    heard: list[AuthenticateRequest] = field(default_factory=list)

    def authenticate(self, request: AuthenticateRequest, /) -> AuthenticateResult:
        self.heard.append(request)
        return authenticate_result.Authenticated(principal="stripe")


@dataclass(frozen=True, slots=True)
class _Principal:
    user_id: str


def _signed_state(contract: ApiContract, signature_header: str | None) -> AccessState:
    headers = {} if signature_header is None else {"stripe-signature": (signature_header,)}

    return AccessState(
        contract=contract,
        operation_id=_PAYMENTS,
        credentials_types={"stripe": CredentialsType(build=dict, attributes={"stripeSignature": "stripe_signature"})},
        raw_parameters={},
        request=RequestView(method="POST", path="/hooks/payments", headers=headers),
        body={"type": "payment.succeeded"},
        raw_body=_RAW_BODY,
    )


def _run(state: AccessState, authenticator: _Authenticator, call: HookCaller) -> None:
    hooks = AccessHooks(authenticate={"stripe": authenticator}, deciders={}, scope_resolvers={})
    asyncio.run(run_access_steps(state, hooks, call))


def test_the_hook_gets_the_parsed_signature_over_the_raw_body(
    tasks_contract: ApiContract, hook_caller: HookCaller
) -> None:
    authenticator = _Authenticator()

    _run(_signed_state(tasks_contract, "t=1700000000,v1=abc,v1=def"), authenticator, hook_caller)

    signature = authenticator.heard[0].signature
    assert isinstance(signature, SignedTemplateRequest)
    assert signature.raw_body == _RAW_BODY
    assert signature.timestamp == "1700000000"
    assert signature.candidate_signatures == ("abc", "def")
    assert signature.key_id == "stripe"
    assert signature.template.encoding is SignatureEncoding.HEX
    assert signature.template.tolerance_ms == 300000


@pytest.mark.parametrize("header", [None, "v1=abc"], ids=["missing", "malformed"])
def test_a_missing_or_malformed_signature_is_unauthenticated(
    tasks_contract: ApiContract, hook_caller: HookCaller, header: str | None
) -> None:
    authenticator = _Authenticator()

    with pytest.raises(ContractRefusal) as refused:
        _run(_signed_state(tasks_contract, header), authenticator, hook_caller)

    assert refused.value.code == "api.unauthenticated"
    assert authenticator.heard == []


def test_the_access_state_repr_shows_no_raw_body(tasks_contract: ApiContract) -> None:
    assert "payment.succeeded" not in repr(_signed_state(tasks_contract, None))


def test_the_principal_members_are_the_declared_ones_by_wire_name(tasks_contract: ApiContract) -> None:
    assert principal_members(tasks_contract, "createTask", _Principal("alice")) == {"userId": "alice"}
    assert principal_members(tasks_contract, "createTask", None) is None


def test_a_principal_that_is_not_the_generated_type_fails_the_boundary(tasks_contract: ApiContract) -> None:
    with pytest.raises(BoundaryFailureError):
        principal_members(tasks_contract, "createTask", "alice")
