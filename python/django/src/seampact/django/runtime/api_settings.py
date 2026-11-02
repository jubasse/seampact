"""The settings of an api (ADR 0027 "Settings"): `settings.SEAMPACT["<api>"]` names the handler factories, the hook
factories and the unexpected-error listener factory by dotted path. The layer imports each path at boot and calls the
factory once per request with the `HttpRequest`."""

from collections.abc import Callable, Mapping
from importlib import import_module
from typing import Final, TypeGuard

from django.conf import settings
from django.http import HttpRequest

from seampact.codegen.runtime.access_steps import AccessHooks
from seampact.hooks import AuthenticateHook, DecideHook, ResolveScopeHook, UnexpectedFailure

SETTINGS_NAME: Final = "SEAMPACT"
HANDLERS_KEY: Final = "handlers"
AUTHENTICATE_KEY: Final = "authenticate"
DECIDERS_KEY: Final = "deciders"
SCOPE_RESOLVERS_KEY: Final = "scope_resolvers"
ON_UNEXPECTED_ERROR_KEY: Final = "on_unexpected_error"
HOOK_KEYS: Final = (AUTHENTICATE_KEY, DECIDERS_KEY, SCOPE_RESOLVERS_KEY)

type Factory = Callable[[HttpRequest], object]


class SettingsError(ValueError):
    """A value of `settings.SEAMPACT` the layer cannot use; the message names the key and the fix."""


def api_settings(api: str) -> Mapping[str, object]:
    """`settings.SEAMPACT["<api>"]`, empty when the app set none."""
    every_api = getattr(settings, SETTINGS_NAME, {})

    if not isinstance(every_api, Mapping):
        raise SettingsError(f"settings.{SETTINGS_NAME} is a {type(every_api).__name__}; set a dict keyed by api id.")

    own = every_api.get(api, {})

    if not isinstance(own, Mapping):
        raise SettingsError(f"settings.{SETTINGS_NAME}['{api}'] is a {type(own).__name__}; set a dict.")

    return own


def dotted_paths(api: str, key: str) -> Mapping[str, str]:
    """The dotted paths of one keyed setting (`handlers`, `authenticate`, ...), empty when it is not set."""
    value = api_settings(api).get(key, {})

    if not isinstance(value, Mapping) or not all(isinstance(path, str) for path in value.values()):
        raise SettingsError(f"settings.{SETTINGS_NAME}['{api}']['{key}'] must map names to dotted paths.")

    return {str(name): path for name, path in value.items()}


def factory(api: str, setting: str, dotted_path: str) -> Factory:
    """The callable a dotted path names; raises `SettingsError` naming the setting when it does not import."""
    module_path, _, attribute = dotted_path.rpartition(".")

    try:
        imported: object = getattr(import_module(module_path), attribute)
    except (ImportError, AttributeError, ValueError) as missing:
        raise SettingsError(
            f"settings.{SETTINGS_NAME}['{api}']{setting} names '{dotted_path}', which does not import ({missing}); "
            "name a callable that takes the HttpRequest."
        ) from missing

    if not callable(imported):
        raise SettingsError(
            f"settings.{SETTINGS_NAME}['{api}']{setting} names '{dotted_path}', which is not callable; name a "
            "callable that takes the HttpRequest."
        )

    return imported


def built(api: str, key: str, name: str, request: HttpRequest) -> object:
    """What the factory of `name` under `key` builds for this request."""
    path = dotted_paths(api, key).get(name)

    if path is None:
        raise SettingsError(
            f"settings.{SETTINGS_NAME}['{api}']['{key}'] has no entry for '{name}'; add its dotted path."
        )

    return factory(api, f"['{key}']['{name}']", path)(request)


def access_hooks(api: str, request: HttpRequest) -> AccessHooks:
    """The hooks the app set for this request, each built by its factory; a hook the contract does not need is
    still built, so a broken factory shows on the first request that reaches the api."""
    return AccessHooks(
        authenticate=_hooks(api, AUTHENTICATE_KEY, request, _is_authenticate_hook, "authenticate"),
        deciders=_hooks(api, DECIDERS_KEY, request, _is_decide_hook, "decide"),
        scope_resolvers=_hooks(api, SCOPE_RESOLVERS_KEY, request, _is_resolve_scope_hook, "resolve_scope"),
    )


def unexpected_error_listener(api: str, request: HttpRequest) -> Callable[[UnexpectedFailure], object] | None:
    """The `on_unexpected_error` method of the listener the app's factory builds, None when the app set none."""
    path = api_settings(api).get(ON_UNEXPECTED_ERROR_KEY)

    if path is None:
        return None

    if not isinstance(path, str):
        raise SettingsError(f"settings.{SETTINGS_NAME}['{api}']['{ON_UNEXPECTED_ERROR_KEY}'] must be a dotted path.")

    listener = factory(api, f"['{ON_UNEXPECTED_ERROR_KEY}']", path)(request)

    return _method(listener, "on_unexpected_error", f"the factory '{path}' of api '{api}'", "UnexpectedErrorListener")


def _hooks[H](
    api: str, key: str, request: HttpRequest, is_hook: Callable[[object], TypeGuard[H]], method: str
) -> Mapping[str, H]:
    hooks: dict[str, H] = {}

    for name in dotted_paths(api, key):
        hook = built(api, key, name, request)

        if not is_hook(hook):
            raise SettingsError(
                f"the factory of settings.{SETTINGS_NAME}['{api}']['{key}']['{name}'] built a "
                f"{type(hook).__qualname__} without a {method} method; return an object with a {method} method."
            )

        hooks[name] = hook

    return hooks


def _is_authenticate_hook(value: object) -> TypeGuard[AuthenticateHook]:
    return callable(getattr(value, "authenticate", None))


def _is_decide_hook(value: object) -> TypeGuard[DecideHook]:
    return callable(getattr(value, "decide", None))


def _is_resolve_scope_hook(value: object) -> TypeGuard[ResolveScopeHook]:
    return callable(getattr(value, "resolve_scope", None))


def _method(built_object: object, method: str, built_by: str, expected: str) -> Callable[[object], object]:
    found = getattr(built_object, method, None)

    if not callable(found):
        raise SettingsError(
            f"{built_by} built a {type(built_object).__qualname__} without a {method} method; return {expected}."
        )

    def call(argument: object) -> object:
        answer: object = found(argument)
        return answer

    return call
