"""The hook doubles of the `tasks` and `tasksService` apis, answering from the loaded script and the suite's
credentials, and the factories SEAMPACT names, which build them per request."""

import logging
import uuid
from typing import Final

from django.http import HttpRequest
from generated.tasks.operations import StripeCredentials, UserCredentials
from generated.tasks.schemas import UserPrincipal, WebhookCaller
from generated.tasks_service.operations import ServiceCredentials
from generated.tasks_service.schemas import Service, ServicePrincipal
from sample_data import channel
from seampact_consumer_suite.control_state import loaded_script, record_hook_call
from seampact_consumer_suite.credentials import credential_number, credential_text
from seampact_consumer_suite.scripted_answers import scripted_scope_denial

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
    purpose,
    scope_id_source,
    scope_resolution,
)
from seampact.signed_webhooks import SignatureScheme, SignedMessage, TemplateSignatureVerifier

UNAUTHENTICATED: Final = "api.unauthenticated"
_FORBIDDEN: Final = "api.forbidden"
_RATE_LIMITED: Final = "api.rate_limited"
_THROTTLE_RULE: Final = "throttle"
_OVERRIDDEN_RIGHT: Final = "tasks.update"
_CALLER_SERVICE_RIGHT: Final = "callerService"
_STRIPE_KEY_ID: Final = "stripe"
_STRIPE_ACCOUNT: Final = "acct_seampact"
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

        return authenticate_result.Authenticated(principal=UserPrincipal(user_id=uuid.UUID(user_id)))


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
    """The `stripe` identity: seampact-signed-webhooks verifies the signature over the raw body with the suite's
    `stripeSecret`, the one secret of the key id `stripe`."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:stripe", request.operation.api, request.operation.id)
        signed = request.signature

        if signed is None or not isinstance(request.credentials, StripeCredentials) or not _verified(signed):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=WebhookCaller(account=_STRIPE_ACCOUNT))


class _StripeSecrets:
    def secrets_for(self, key_id: str) -> list[str]:
        return [credential_text("stripeSecret")] if key_id == _STRIPE_KEY_ID else []


def _verified(signed: SignedTemplateRequest) -> bool:
    template = signed.template
    scheme = SignatureScheme(template.algorithm, template.payload, template.encoding.value, template.tolerance_ms)
    message = SignedMessage(signed.raw_body, signed.timestamp, signed.candidate_signatures)

    return TemplateSignatureVerifier(_StripeSecrets()).verify(message, signed.key_id, scheme).verified


class TasksDecider:
    """The `tasks` api's decider for every right and rule: it spends the throttled user's bucket, denies what the
    script denies and allows the rest."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request)

        if denied is None and request.name == _THROTTLE_RULE and request.bucket is not None:
            if _is_throttled_user(request.principal):
                params = {"retryAfterMs": credential_number("throttleRetryAfterMs")}
                return decision.Denied(deny=ErrorCodeWithParams(code=_RATE_LIMITED, params=params))

        return decision.Allowed() if denied is None else decision.Denied(deny=ErrorCodeWithParams(code=denied))


class OverriddenRightDecider:
    """The app's own decider for the overridden right (CHK-091): it records under its own hook name and denies what
    the script denies, while every other right and rule reaches the generic decider."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide-override:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request)

        return decision.Allowed() if denied is None else decision.Denied(deny=ErrorCodeWithParams(code=denied))


class ServiceHook:
    """The `tasksService` api's `service` identity: one of the fixed service JWTs, accepted as is."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:service", request.operation.api, request.operation.id)
        credentials = request.credentials
        token = credentials.internal_token if isinstance(credentials, ServiceCredentials) else None
        services = {
            credential_text("serviceJwt"): credential_text("serviceName"),
            credential_text("foreignServiceJwt"): credential_text("foreignServiceName"),
        }
        service = None if token is None else services.get(token)

        if service is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        principal = ServicePrincipal(service=Service(service), user_id=uuid.UUID(credential_text("userId")))

        return authenticate_result.Authenticated(principal=principal)


class ServiceDecider:
    """The `tasksService` api's decider: denies what the script denies, else `callerService` for a service its
    params do not list."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request)

        if denied is not None:
            return decision.Denied(deny=ErrorCodeWithParams(code=denied))

        if request.name == _CALLER_SERVICE_RIGHT and not _caller_listed(request):
            return decision.Denied(deny=ErrorCodeWithParams(code=_FORBIDDEN, params={}))

        return decision.Allowed()


def _caller_listed(request: RequirementRequest) -> bool:
    allowed = (request.params or {}).get("allowed")
    principal = request.principal

    return isinstance(principal, ServicePrincipal) and isinstance(allowed, list) and principal.service in allowed


def _is_throttled_user(principal: object) -> bool:
    """The throttled user's bucket is always spent; every other caller's never is."""
    return isinstance(principal, UserPrincipal) and str(principal.user_id) == credential_text("throttledUserId")


def scripted_decision(request: RequirementRequest) -> str | None:
    """The code the loaded script denies this right or rule with, for its purpose or any."""
    decisions = loaded_script().get("decisions")
    purpose_name = _purpose_name(request.purpose)

    for scripted in decisions if isinstance(decisions, list) else []:
        if not isinstance(scripted, dict) or scripted.get("name") != request.name:
            continue

        if scripted.get("purpose", purpose_name) != purpose_name:
            continue

        deny = scripted.get("deny")
        code = deny.get("code") if isinstance(deny, dict) else None

        if not isinstance(code, str):
            raise ValueError("the loaded script holds a decision without a denial code")

        return code

    return None


def _purpose_name(decided_for: object) -> str:
    if isinstance(decided_for, purpose.Route):
        return "route"

    if isinstance(decided_for, purpose.Field):
        return "field"

    if isinstance(decided_for, purpose.SortKey):
        return "sortKey"

    raise ValueError(f"the decide request has the unknown purpose {type(decided_for).__qualname__}")


class TasksUnexpectedErrors:
    def on_unexpected_error(self, failure: UnexpectedFailure) -> None:
        why = failure.reason if failure.cause is None else str(failure.cause)
        _LOGGER.error("unexpected failure in %s.%s: %s", failure.api, failure.operation or "(none)", why)


def user_hook(request: HttpRequest) -> UserHook:
    return UserHook()


def channel_resolver(request: HttpRequest) -> ChannelResolver:
    return ChannelResolver()


def unexpected_errors(request: HttpRequest) -> TasksUnexpectedErrors:
    return TasksUnexpectedErrors()


def stripe_hook(request: HttpRequest) -> StripeHook:
    return StripeHook()


def tasks_decider(request: HttpRequest) -> TasksDecider:
    return TasksDecider()


def overridden_right_decider(request: HttpRequest) -> OverriddenRightDecider:
    return OverriddenRightDecider()


def service_hook(request: HttpRequest) -> ServiceHook:
    return ServiceHook()


def service_decider(request: HttpRequest) -> ServiceDecider:
    return ServiceDecider()
