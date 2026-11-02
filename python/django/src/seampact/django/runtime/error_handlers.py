"""The exceptions behind replies the boundary does not see raised (ADR 0027 "Exceptions on contract routes"): at boot
the layer wraps the root URLconf's `handler400`, `handler403`, `handler404` and `handler500`, with Django's defaults
when the app set none, and connects a `got_request_exception` receiver. Each records the exception in the request's
holders, then the app's handler renders as it always did."""

import sys
from collections.abc import Callable
from functools import wraps
from importlib import import_module
from types import ModuleType
from typing import Final

from django.conf import settings
from django.core.signals import got_request_exception
from django.http import HttpRequest, HttpResponseBase
from django.urls import clear_url_caches
from django.views import defaults

from seampact.django.runtime.request_state import record_exception

_WRAPPED_MARK: Final = "seampact_records_exceptions"
_RECEIVER_UID: Final = "seampact.django.record_exception"
_DEFAULTS: Final[dict[str, Callable[..., HttpResponseBase]]] = {
    "handler400": defaults.bad_request,
    "handler403": defaults.permission_denied,
    "handler404": defaults.page_not_found,
}
_SERVER_ERROR_HANDLER: Final = "handler500"


def wrap_error_handlers() -> None:
    """Wraps the root URLconf's handlers once per process and connects the receiver; idempotent."""
    urlconf = _root_urlconf()

    for name, default in _DEFAULTS.items():
        handler = getattr(urlconf, name, default)

        if not _is_wrapped(handler):
            setattr(urlconf, name, _recording(handler))

    server_error = getattr(urlconf, _SERVER_ERROR_HANDLER, defaults.server_error)

    if not _is_wrapped(server_error):
        setattr(urlconf, _SERVER_ERROR_HANDLER, _recording_server_error(server_error))

    got_request_exception.connect(_record_signalled_exception, dispatch_uid=_RECEIVER_UID)
    clear_url_caches()


def unwrapped_error_handlers() -> list[str]:
    """The root URLconf's handlers that carry no wrapper."""
    urlconf = _root_urlconf()
    names = [*_DEFAULTS, _SERVER_ERROR_HANDLER]

    return [name for name in names if not _is_wrapped(getattr(urlconf, name, None))]


def _root_urlconf() -> ModuleType:
    root: object = settings.ROOT_URLCONF

    return root if isinstance(root, ModuleType) else import_module(str(root))


def _is_wrapped(handler: object) -> bool:
    return getattr(handler, _WRAPPED_MARK, False) is True


def _recording(handler: Callable[..., HttpResponseBase]) -> Callable[..., HttpResponseBase]:
    @wraps(handler)
    def recorded(request: HttpRequest, exception: BaseException) -> HttpResponseBase:
        record_exception(request, exception)

        return handler(request, exception)

    setattr(recorded, _WRAPPED_MARK, True)

    return recorded


def _recording_server_error(handler: Callable[..., HttpResponseBase]) -> Callable[..., HttpResponseBase]:
    @wraps(handler)
    def recorded(request: HttpRequest) -> HttpResponseBase:
        exception = sys.exc_info()[1]

        if exception is not None:
            record_exception(request, exception)

        return handler(request)

    setattr(recorded, _WRAPPED_MARK, True)

    return recorded


def _record_signalled_exception(sender: object, request: HttpRequest | None = None, **kwargs: object) -> None:
    exception = sys.exc_info()[1]

    if request is not None and exception is not None:
        record_exception(request, exception)
