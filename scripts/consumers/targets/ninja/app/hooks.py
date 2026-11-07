"""The hook factories the `bind_*()` functions take: each builds its shared hook double per request,
the `user` hook from the caller Ninja's `auth=` signed in, and the file idempotency store."""

from pathlib import Path
from typing import Final

from auth import suite_token_auth
from django.http import HttpRequest
from hook_doubles import (
    ChannelResolver,
    DeviceHook,
    OverriddenRightDecider,
    ServiceDecider,
    ServiceHook,
    StripeHook,
    TasksDecider,
    TasksUnexpectedErrors,
    UserHook,
)
from seampact_consumer_suite.file_idempotency_store import FileIdempotencyStore

_IDEMPOTENCY_STORE_FILE: Final = Path(__file__).parent / "suite-idempotency.json"


def user_hook(request: HttpRequest) -> UserHook:
    return UserHook(getattr(request, "auth", None))


def device_hook(request: HttpRequest) -> DeviceHook:
    return DeviceHook()


def optional_user_hook(request: HttpRequest) -> UserHook:
    """The `user` hook of the optional-auth api: Ninja refuses an `auth=` on its routes, which declare no 401, so the
    factory reads the bearer token as that authentication does."""
    return UserHook(suite_token_auth(request))


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


def idempotency_store(request: HttpRequest) -> FileIdempotencyStore:
    return FileIdempotencyStore(str(_IDEMPOTENCY_STORE_FILE))
