"""The framework-free hook doubles of every api of the reference contract, answering from the loaded script and the
suite's credentials. The app builds them per request; its own `user` hook factory hands `UserHook` the caller its
framework's bearer authentication signed in, so the suite fails if a contract route skipped that authentication."""

import logging
import uuid
from dataclasses import dataclass, field
from typing import Final

from generated.tasks.operations import StripeCredentials, UserCredentials
from generated.tasks.schemas import UserPrincipal, WebhookCaller
from generated.tasks_absolute_urls.operations import UserCredentials as AbsoluteUrlsUserCredentials
from generated.tasks_absolute_urls.schemas import UserPrincipal as AbsoluteUrlsUserPrincipal
from generated.tasks_devices.operations import DeviceCredentials
from generated.tasks_devices.schemas import DevicePrincipal
from generated.tasks_optional_auth.operations import UserCredentials as OptionalAuthUserCredentials
from generated.tasks_optional_auth.schemas import UserPrincipal as OptionalAuthUserPrincipal
from generated.tasks_service.operations import ServiceCredentials
from generated.tasks_service.schemas import Service, ServicePrincipal
from generated.tasks_service_writes.operations import ServiceCredentials as WritesServiceCredentials
from generated.tasks_service_writes.schemas import Service as WritesService
from generated.tasks_service_writes.schemas import ServicePrincipal as WritesServicePrincipal
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
_NOT_FOUND: Final = "api.not_found"
# The sample channel the sample user is not a member of: the resolver denies it, so no handler runs for it.
_NON_MEMBER_CHANNEL_ID: Final = "10000000-0000-4000-8000-0000000000ff"
_RATE_LIMITED: Final = "api.rate_limited"
_THROTTLE_RULE: Final = "throttle"
_LOGGER: Final = logging.getLogger("consumer.tasks")


@dataclass(frozen=True, slots=True)
class TokenUser:
    """The caller a bearer token of the suite's credentials signs in; DRF reads `is_authenticated`."""

    user_id: str
    token: str = field(repr=False)
    is_authenticated: bool = True


def user_id_of(token: str) -> str | None:
    """The user id the suite's credentials give a token, None for an unknown one."""
    user_ids = {
        credential_text("userToken"): credential_text("userId"),
        credential_text("throttledUserToken"): credential_text("throttledUserId"),
    }

    return user_ids.get(token)


_USER_CREDENTIALS: Final = (UserCredentials, OptionalAuthUserCredentials, AbsoluteUrlsUserCredentials)
_SERVICE_CREDENTIALS: Final = (ServiceCredentials, WritesServiceCredentials)


class UserHook:
    """The `user` identity of the `tasks`, `tasksOptionalAuth` and `tasksAbsoluteUrls` apis: a bearer token the
    framework's authentication signed in, or a token of the credentials as the session cookie."""

    def __init__(self, signed_in: object) -> None:
        self._signed_in = signed_in

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:user", request.operation.api, request.operation.id)
        credentials = request.credentials

        if not isinstance(credentials, _USER_CREDENTIALS):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        user_id = self._user_id(credentials.bearer, credentials.session_cookie)

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        return authenticate_result.Authenticated(principal=_user_principal(credentials, uuid.UUID(user_id)))

    def _user_id(self, bearer: str | None, session_cookie: str | None) -> str | None:
        if bearer is not None:
            user = self._signed_in
            return user.user_id if isinstance(user, TokenUser) and user.token == bearer else None

        return None if session_cookie is None else user_id_of(session_cookie)


def _user_principal(credentials: object, user_id: uuid.UUID) -> object:
    """The principal of the api whose credentials the request presents."""
    if isinstance(credentials, OptionalAuthUserCredentials):
        return OptionalAuthUserPrincipal(user_id=user_id)

    if isinstance(credentials, AbsoluteUrlsUserCredentials):
        return AbsoluteUrlsUserPrincipal(user_id=user_id)

    return UserPrincipal(user_id=user_id)


class DeviceHook:
    """The `tasksDevices` api's `device` identity: the paired device's token, accepted as is."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:device", request.operation.api, request.operation.id)
        credentials = request.credentials
        device_token = credentials.device_token if isinstance(credentials, DeviceCredentials) else None

        if device_token is None or device_token != credential_text("deviceToken"):
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        device_id = uuid.UUID(credential_text("deviceId"))

        return authenticate_result.Authenticated(principal=DevicePrincipal(device_id=device_id))


class ChannelResolver:
    """Resolves a declared channel id to its sample channel, the sample user a member of every channel but one,
    unless the script denies it."""

    def resolve_scope(self, request: ResolveScopeRequest) -> ScopeResolution:
        source = request.source

        if not isinstance(source, scope_id_source.Declared):
            raise TypeError(f"the consumer resolves declared scope ids only, not those of '{request.scope}'")

        denied = scripted_scope_denial(request.scope)

        if denied is not None:
            return scope_resolution.Denied(deny=ErrorCodeWithParams(code=denied))

        if str(source.id) == _NON_MEMBER_CHANNEL_ID:
            return scope_resolution.Denied(deny=ErrorCodeWithParams(code=_NOT_FOUND))

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
    """The `service` identity of the `tasksService` and `tasksServiceWrites` apis: one of the fixed service JWTs,
    accepted as is."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:service", request.operation.api, request.operation.id)
        token = self.service_token(request)
        services = {
            credential_text("serviceJwt"): credential_text("serviceName"),
            credential_text("foreignServiceJwt"): credential_text("foreignServiceName"),
        }
        service = None if token is None else services.get(token)

        if service is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        user_id = uuid.UUID(credential_text("userId"))
        principal: object = (
            WritesServicePrincipal(service=WritesService(service), user_id=user_id)
            if isinstance(request.credentials, WritesServiceCredentials)
            else ServicePrincipal(service=Service(service), user_id=user_id)
        )

        return authenticate_result.Authenticated(principal=principal)

    def service_token(self, request: AuthenticateRequest) -> str | None:
        """The service token of the request's credentials; an app reading it through its framework overrides this."""
        credentials = request.credentials

        return credentials.internal_token if isinstance(credentials, _SERVICE_CREDENTIALS) else None


class ServiceDecider:
    """The decider of the `tasksService` and `tasksServiceWrites` apis: denies what the script denies, else
    `callerService` for a service its params do not list."""

    def decide(self, request: RequirementRequest) -> Decision:
        record_hook_call(f"decide:{request.name}", request.operation.api, request.operation.id)
        denied = scripted_decision(request.name, request.purpose)

        if denied is not None:
            return decision.Denied(deny=ErrorCodeWithParams(code=denied))

        if request.name == CALLER_SERVICE_RIGHT and not _caller_listed(request):
            return decision.Denied(deny=ErrorCodeWithParams(code=_FORBIDDEN, params={}))

        return decision.Allowed()


def _caller_listed(request: RequirementRequest) -> bool:
    # The decider receives the right's generated params class, whose `allowed` holds Service members.
    allowed = getattr(request.params, "allowed", None)
    principal = request.principal

    service = principal.service if isinstance(principal, ServicePrincipal | WritesServicePrincipal) else None

    if service is None or not isinstance(allowed, list):
        return False

    return str(service) in {str(getattr(member, "value", member)) for member in allowed}


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
