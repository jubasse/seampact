"""The hook doubles of the `tasks` and `tasksService` apis, answering from the loaded script and the suite's
credentials: the `user`, `stripe` and `service` identities, the channel resolver, the deciders of every right and rule,
and the listener. The `user` and `service` factories read their bearer token through FastAPI `Security` schemes
(`OAuth2PasswordBearer`, `HTTPBearer`), as an app's own security layer does, and the hook decides."""

import logging
import uuid
from typing import Annotated, Final

from fastapi import Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer
from generated.tasks.operations import UserCredentials
from generated.tasks.schemas import UserPrincipal, WebhookCaller
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
RATE_LIMITED: Final = "api.rate_limited"
THROTTLE_RULE: Final = "throttle"
OVERRIDDEN_RIGHT: Final = "tasks.update"
CALLER_SERVICE_RIGHT: Final = "callerService"
_FORBIDDEN: Final = "api.forbidden"
# Without a bearer token the scheme hands None to the factory, so a session-cookie caller still reaches the hook.
_USER_BEARER: Final = OAuth2PasswordBearer(tokenUrl="/token", auto_error=False)
_SERVICE_BEARER: Final = HTTPBearer(auto_error=False)
_LOGGER: Final = logging.getLogger("consumer.tasks")


class UserHook:
    """The `user` identity: the bearer token the app's `OAuth2PasswordBearer` read, or the same token as the session
    cookie of the credentials."""

    def __init__(self, bearer: str | None) -> None:
        self.bearer = bearer

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:user", request.operation.api, request.operation.id)
        credentials = request.credentials
        session_cookie = credentials.session_cookie if isinstance(credentials, UserCredentials) else None
        token = self.bearer or session_cookie
        user_ids = {
            credential_text("userToken"): credential_text("userId"),
            credential_text("throttledUserToken"): credential_text("throttledUserId"),
        }
        user_id = None if token is None else user_ids.get(token)

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=UserPrincipal.model_validate({"user_id": user_id}))


def user_hook(bearer: Annotated[str | None, Security(_USER_BEARER)]) -> UserHook:
    return UserHook(bearer)


class ServiceHook:
    """The `tasksService` api's `service` identity: one of the fixed service JWTs the app's `HTTPBearer` read,
    accepted as is."""

    def __init__(self, token: str | None) -> None:
        self.token = token

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:service", request.operation.api, request.operation.id)
        services = {
            credential_text("serviceJwt"): credential_text("serviceName"),
            credential_text("foreignServiceJwt"): credential_text("foreignServiceName"),
        }
        service = None if self.token is None else services.get(self.token)

        if service is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        principal = ServicePrincipal(service=Service(service), user_id=uuid.UUID(credential_text("userId")))

        return authenticate_result.Authenticated(principal=principal)


def service_hook(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_SERVICE_BEARER)],
) -> ServiceHook:
    return ServiceHook(None if credentials is None else credentials.credentials)


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
        if not stripe_signature_verified(request.signature):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=WebhookCaller.model_validate({"account": STRIPE_ACCOUNT}))


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
