"""Where an api's run-time values come from (ADR 0027 "Settings"): `settings.SEAMPACT["<api>"]` by default, or the
values a target's `bind_<api>()` registered for the api (Ninja). The boundary, its replies, the idempotency claim and
the boot check read them here, so neither source is read behind the other's back."""

from collections.abc import Callable
from typing import Protocol

from django.http import HttpRequest

from seampact.codegen.runtime.access_steps import AccessHooks
from seampact.django.runtime.api_settings import SettingsConfiguration
from seampact.hooks import IdempotencyStore, UnexpectedFailure


class ApiConfiguration(Protocol):
    """The run-time values of one api; each per-request value is built by its factory for that request."""

    def access_hooks(self, request: HttpRequest) -> AccessHooks: ...

    def unexpected_error_listener(self, request: HttpRequest) -> Callable[[UnexpectedFailure], object] | None:
        """The listener's `on_unexpected_error`, None when the app set none."""
        ...

    def idempotency_store(self, request: HttpRequest) -> IdempotencyStore | None: ...

    def public_origin(self) -> object:
        """The origin as the app set it, unchecked: the boot check names a malformed one."""
        ...

    def responses(self, operation_id: str) -> str | None:
        """The operation's `responses` mode, else the api's; None leaves the generated option."""
        ...


_bound: dict[str, ApiConfiguration] = {}


def register_configuration(api: str, configuration: ApiConfiguration) -> None:
    """The api's values come from `configuration` from now on; a second registration replaces the first, as
    `bind_<api>()` on another NinjaAPI does."""
    _bound[api] = configuration


def registered_configuration(api: str) -> ApiConfiguration | None:
    return _bound.get(api)


def configuration_of(api: str) -> ApiConfiguration:
    """The registered values of the api, else its `settings.SEAMPACT` entry."""
    return _bound.get(api) or SettingsConfiguration(api)
