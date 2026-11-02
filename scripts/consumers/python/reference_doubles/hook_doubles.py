"""The framework-free hook doubles of the `tasks` and `tasksService` apis, answering from the loaded script and the
suite's credentials. The app builds them per request; its own `user` hook factory hands `UserHook` the caller its
framework's bearer authentication signed in, so the suite fails if a contract route skipped that authentication."""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Final

from generated.tasks.operations import StripeCredentials, UserCredentials
from generated.tasks.schemas import UserPrincipal, WebhookCaller
from generated.tasks_service.operations import ServiceCredentials
from generated.tasks_service.schemas import Service, ServicePrincipal
from sample_data import channel
from seampact_consumer_suite.control_state import record_hook_call
from seampact_consumer_suite.credentials import credential_number, credential_text
from seampact_consumer_suite.scripted_answers import scripted_scope_denial
from seampact_consumer_suite.scripted_decisions import scripted_decision
from seampact_consumer_suite.stripe_signature import STRIPE_ACCOUNT, stripe_signature_verified

from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    ErrorCodeWithParams,
    RequirementRequest,
    ResolvedScope,
    ResolveScopeRequest,
    ScopeResolution,
    UnexpectedFailure,
    authenticate_result,
    decision,
    scope_id_source,
    scope_resolution,
)

UNAUTHENTICATED: Final = "api.unauthenticated"
OVERRIDDEN_RIGHT: Final = "tasks.update"
CALLER_SERVICE_RIGHT: Final = "callerService"
_FORBIDDEN: Final = "api.forbidden"
_RATE_LIMITED: Final = "api.rate_limited"
_THROTTLE_RULE: Final = "throttle"
_LOGGER: Final = logging.getLogger("consumer.tasks")


@dataclass(frozen=True, slots=True)
class TokenUser:
    """The caller a bearer token of the suite's credentials signs in."""

    user_id: str
    token: str = field(repr=False)


def user_id_of(token: str) -> str | None:
    """The user id the suite's credentials give a token, None for an unknown one."""
    user_ids = {
        credential_text("userToken"): credential_text("userId"),
        credential_text("throttledUserToken"): credential_text("throttledUserId"),
    }

    return user_ids.get(token)


class UserHook:
    """The `user` identity: a bearer token the framework's authentication signed in, or a token of the credentials
    as the session cookie."""

    def __init__(self, signed_in: object) -> None:
        self._signed_in = signed_in

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:user", request.operation.api, request.operation.id)
        credentials = request.credentials
        user_id = self._user_id(credentials) if isinstance(credentials, UserCredentials) else None

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=UserPrincipal(user_id=uuid.UUID(user_id)))

    def _user_id(self, credentials: UserCredentials) -> str | None:
        if credentials.bearer is not None:
            user = self._signed_in
            signed_in = isinstance(user, TokenUser) and user.token == credentials.bearer
            return user.user_id if signed_in else None

        return None if credentials.session_cookie is None else user_id_of(credentials.session_cookie)


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
    """The `stripe` identity: the shared suite check verifies the signature over the raw body."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:stripe", request.operation.api, request.operation.id)

        if not isinstance(request.credentials, StripeCredentials) or not stripe_signature_verified(request.signature):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=WebhookCaller(account=STRIPE_ACCOUNT))


class TasksDecider:
    """The `tasks` api's decider for every right and rule: it spends the throttled user's bucket, denies what the
    script denies and allows the rest."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request.name, request.purpose)

        if denied is None and _spends_throttled_bucket(request):
            params = {"retryAfterMs": credential_number("throttleRetryAfterMs")}
            return decision.Denied(deny=ErrorCodeWithParams(code=_RATE_LIMITED, params=params))

        return decision.Allowed() if denied is None else decision.Denied(deny=ErrorCodeWithParams(code=denied))


class OverriddenRightDecider:
    """The app's own decider for the overridden right (CHK-091): it records under its own hook name and denies what
    the script denies, while every other right and rule reaches the generic decider."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide-override:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request.name, request.purpose)

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
        denied = scripted_decision(request.name, request.purpose)

        if denied is not None:
            return decision.Denied(deny=ErrorCodeWithParams(code=denied))

        if request.name == CALLER_SERVICE_RIGHT and not _caller_listed(request):
            return decision.Denied(deny=ErrorCodeWithParams(code=_FORBIDDEN, params={}))

        return decision.Allowed()


def _caller_listed(request: RequirementRequest) -> bool:
    allowed = (request.params or {}).get("allowed")
    principal = request.principal

    return isinstance(principal, ServicePrincipal) and isinstance(allowed, list) and principal.service in allowed


def _spends_throttled_bucket(request: RequirementRequest) -> bool:
    """The throttled user's bucket is always spent; every other caller's never is."""
    principal = request.principal
    throttled_user_id = credential_text("throttledUserId")
    throttled_user = isinstance(principal, UserPrincipal) and str(principal.user_id) == throttled_user_id

    return request.name == _THROTTLE_RULE and request.bucket is not None and throttled_user


class TasksUnexpectedErrors:
    def on_unexpected_error(self, failure: UnexpectedFailure) -> None:
        why = failure.reason if failure.cause is None else str(failure.cause)
        _LOGGER.error("unexpected failure in %s.%s: %s", failure.api, failure.operation or "(none)", why)
