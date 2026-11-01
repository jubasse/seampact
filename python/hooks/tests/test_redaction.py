"""Credentials, raw bodies, signatures, headers and stored bodies never show in a repr, a log line or `rich`."""

import asyncio
import logging
import pprint
from collections.abc import Awaitable, Callable
from typing import Final

import pytest
from rich.pretty import pretty_repr

from seampact.hooks import (
    AuthenticateRequest,
    DecideHook,
    Decision,
    OperationRef,
    RequestView,
    RequirementKind,
    RequirementRequest,
    SignatureEncoding,
    SignatureTemplate,
    SignedApplicationRequest,
    SignedTemplateRequest,
    StoredResponse,
)
from seampact.hooks.decision import Allowed
from seampact.hooks.purpose import Route

_SECRET: Final = "sk_live_SENSITIVE"
_REDACTED: Final = "[redacted]"
_OPERATION: Final = OperationRef(api="orders", id="createOrder")


def _request_view() -> RequestView:
    return RequestView(method="POST", path="/orders", headers={"authorization": (f"Bearer {_SECRET}",)})


def _template_request() -> SignedTemplateRequest:
    template = SignatureTemplate(
        algorithm="hmac-sha256", payload="{ts}.{rawBody}", encoding=SignatureEncoding.HEX, tolerance_ms=300_000
    )

    return SignedTemplateRequest(
        raw_body=_SECRET.encode(),
        timestamp="1700000000",
        candidate_signatures=(_SECRET,),
        key_id="k1",
        template=template,
    )


def _sensitive_values() -> list[object]:
    application_request = SignedApplicationRequest(
        raw_body=_SECRET.encode(), signature_header=_SECRET, headers={"x-signature": _SECRET}
    )
    authenticate_request = AuthenticateRequest(
        identity="bearer",
        credentials={"token": _SECRET},
        csrf_token=_SECRET,
        signature=_template_request(),
        request=_request_view(),
        operation=_OPERATION,
        extensions={},
    )
    stored_response = StoredResponse(
        status=201, headers=(StoredResponse.Header(name="set-cookie", value=_SECRET),), body=_SECRET.encode()
    )

    requirement_request = RequirementRequest(
        kind=RequirementKind.RIGHT,
        name="orders.refund",
        principal=None,
        scopes=(),
        proof={"reauthToken": _SECRET},
        purpose=Route(),
        operation=_OPERATION,
        request=RequestView(method="POST", path="/orders", headers={}),
        extensions=RequirementRequest.Extensions(requirement={}, operation={}),
    )

    return [
        _request_view(),
        _template_request(),
        application_request,
        authenticate_request,
        stored_response,
        requirement_request,
    ]


@pytest.mark.parametrize("render", [repr, str, pprint.pformat, pretty_repr], ids=["repr", "str", "pprint", "rich"])
@pytest.mark.parametrize("value", _sensitive_values(), ids=lambda value: type(value).__qualname__)
def test_a_sensitive_value_renders_redacted(render: Callable[[object], str], value: object) -> None:
    rendered = render(value)

    assert _REDACTED in rendered
    assert _SECRET not in rendered


def test_a_logged_request_is_redacted(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO):
        logging.getLogger("seampact.test").info("authenticating %r", _sensitive_values()[3])

    assert _REDACTED in caplog.text
    assert _SECRET not in caplog.text


def test_the_unredacted_members_still_show() -> None:
    assert "path='/orders'" in repr(_request_view())
    assert "key_id='k1'" in repr(_template_request())


class _SyncDecide:
    def decide(self, request: RequirementRequest) -> Decision:
        return Allowed()


# Hook parameters are positional-only, so an implementation may name its parameter freely.
class _DecideNamingItsParameterAnotherWay:
    def decide(self, req: RequirementRequest) -> Decision:
        return Allowed()


class _AsyncDecide:
    async def decide(self, request: RequirementRequest) -> Decision:
        return Allowed()


# How a placement calls a hook that may be a plain `def` or an `async def`.
async def _decision_of(hook: DecideHook, request: RequirementRequest) -> Decision:
    answer = hook.decide(request)

    return await answer if isinstance(answer, Awaitable) else answer


def test_a_def_and_an_async_def_hook_both_satisfy_the_protocol() -> None:
    request = RequirementRequest(
        kind=RequirementKind.RIGHT,
        name="orders.create",
        principal=None,
        scopes=(),
        purpose=Route(),
        operation=_OPERATION,
        request=_request_view(),
        extensions=RequirementRequest.Extensions(requirement={}, operation={}),
    )
    hooks: list[DecideHook] = [_SyncDecide(), _AsyncDecide(), _DecideNamingItsParameterAnotherWay()]

    assert [asyncio.run(_decision_of(hook, request)) for hook in hooks] == [Allowed(), Allowed(), Allowed()]
