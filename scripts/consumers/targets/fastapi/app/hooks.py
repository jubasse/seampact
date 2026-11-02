"""The hook doubles of the `tasks` api, answering from the loaded script and the suite's credentials: the `user` and
`stripe` identities, the channel resolver, the deciders of every right and rule, and the listener."""

import logging
from collections.abc import Sequence
from typing import Final

from generated.tasks.operations import UserCredentials
from generated.tasks.schemas import UserPrincipal, WebhookCaller
from sample_data import channel
from seampact_consumer_suite.control_state import record_hook_call
from seampact_consumer_suite.credentials import credential_number, credential_text
from seampact_consumer_suite.scripted_answers import scripted_scope_denial
from suite_decisions import scripted_decision

from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    ErrorCodeWithParams,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    ScopeResolution,
    SignedTemplateRequest,
    UnexpectedFailure,
    authenticate_result,
    decision,
    scope_id_source,
    scope_resolution,
)
from seampact.signed_webhooks import SignatureEncoding, SignatureScheme, SignedMessage, TemplateSignatureVerifier

UNAUTHENTICATED: Final = "api.unauthenticated"
RATE_LIMITED: Final = "api.rate_limited"
THROTTLE_RULE: Final = "throttle"
OVERRIDDEN_RIGHT: Final = "tasks.update"
STRIPE_ACCOUNT: Final = "acct_seampact"
_STRIPE_KEY_ID: Final = "stripe"
_LOGGER: Final = logging.getLogger("consumer.tasks")


class UserHook:
    """The `user` identity: a bearer token of the credentials, or the same token as the session cookie."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:user", request.operation.api, request.operation.id)
        credentials = request.credentials
        token = (credentials.bearer or credentials.session_cookie) if isinstance(credentials, UserCredentials) else None
        user_ids = {
            credential_text("userToken"): credential_text("userId"),
            credential_text("throttledUserToken"): credential_text("throttledUserId"),
        }
        user_id = None if token is None else user_ids.get(token)

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=UserPrincipal.model_validate({"user_id": user_id}))


class ChannelResolver:
    """Resolves a declared channel id to its sample channel, every channel existing, unless the script denies it."""

    def resolve_scope(self, request: ResolveScopeRequest) -> ScopeResolution:
        source = request.source

        if not isinstance(source, scope_id_source.Declared):
            raise TypeError(f"the consumer resolves declared scope ids only, not those of '{request.scope}'")

        denied = scripted_scope_denial(request.scope)

        if denied is not None:
            return scope_resolution.Denied(deny=ErrorCodeWithParams(code=denied))

        resolved = ResolvedScope(scope=request.scope, id=source.id, value=channel(str(source.id)))

        return scope_resolution.Resolved(resolved=resolved)


class StripeHook:
    """The `stripe` identity: `seampact-signed-webhooks` verifies the signature over the raw body with the suite's
    `stripeSecret`, the one secret of the key id `stripe`."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:stripe", request.operation.api, request.operation.id)
        signed = request.signature

        if not isinstance(signed, SignedTemplateRequest) or not _verified(signed):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=WebhookCaller.model_validate({"account": STRIPE_ACCOUNT}))


class _StripeSecrets:
    def secrets_for(self, key_id: str) -> Sequence[str | bytes]:
        return [credential_text("stripeSecret")] if key_id == _STRIPE_KEY_ID else []


def _verified(signed: SignedTemplateRequest) -> bool:
    template = signed.template
    scheme = SignatureScheme(
        algorithm=template.algorithm,
        payload=template.payload,
        encoding=SignatureEncoding(template.encoding.value),
        tolerance_ms=template.tolerance_ms,
    )
    message = SignedMessage(
        raw_body=signed.raw_body, timestamp=signed.timestamp, candidate_signatures=signed.candidate_signatures
    )

    return TemplateSignatureVerifier(_StripeSecrets()).verify(message, signed.key_id, scheme).verified


class TasksDecider:
    """The decide double of every right and rule: it spends the throttled user's bucket, denies what the script
    denies and allows the rest."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request.name, request.purpose)

        if denied is None and request.name == THROTTLE_RULE and _spends_bucket(request):
            params = {"retryAfterMs": credential_number("throttleRetryAfterMs")}
            return decision.Denied(deny=ErrorCodeWithParams(code=RATE_LIMITED, params=params))

        return decision.Allowed() if denied is None else decision.Denied(deny=ErrorCodeWithParams(code=denied))


class OverriddenRightDecider:
    """The app's own decider for the overridden right: it records under its own hook name and denies what the script
    denies, while every other right and rule reaches `TasksDecider`."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide-override:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request.name, request.purpose)

        return decision.Allowed() if denied is None else decision.Denied(deny=ErrorCodeWithParams(code=denied))


# The throttled user's bucket is always spent; every other caller's never is.
def _spends_bucket(request: RequirementRequest) -> bool:
    principal = request.principal

    return (
        request.bucket is not None
        and isinstance(principal, UserPrincipal)
        and str(principal.user_id) == credential_text("throttledUserId")
    )


class TasksUnexpectedErrors:
    def on_unexpected_error(self, failure: UnexpectedFailure) -> None:
        why = failure.reason if failure.cause is None else str(failure.cause)
        _LOGGER.error("unexpected failure in %s.%s: %s", failure.api, failure.operation or "(none)", why)
