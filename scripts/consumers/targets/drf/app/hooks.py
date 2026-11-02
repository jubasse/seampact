"""The hook doubles of the `tasks` api, answering from the loaded script and the suite's credentials, and the factories
SEAMPACT names, which build them per request."""

import logging
import uuid
from typing import Final

from django.http import HttpRequest
from generated.tasks.operations import UserCredentials
from generated.tasks.schemas import UserPrincipal
from sample_data import channel
from seampact_consumer_suite.control_state import record_hook_call
from seampact_consumer_suite.credentials import credential_text
from seampact_consumer_suite.scripted_answers import scripted_scope_denial

from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    ErrorCodeWithParams,
    ResolvedScope,
    ResolveScopeRequest,
    ScopeResolution,
    UnexpectedFailure,
    authenticate_result,
    scope_id_source,
    scope_resolution,
)

UNAUTHENTICATED: Final = "api.unauthenticated"
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
