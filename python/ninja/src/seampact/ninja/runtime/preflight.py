"""A CORS preflight the boundary left to the app reaches Ninja when no CORS layer answered it; `OPTIONS` is no contract
method, so Ninja would answer 405. Each contract path's Router declares `OPTIONS` with this view, which answers the
path's 404, as the boundary answers any method the path does not serve (ADR 0027 "Ninja")."""

import inspect
from collections.abc import Awaitable, Callable
from typing import Final

from django.http import HttpRequest, HttpResponse

from seampact.codegen.runtime.contract import NOT_FOUND_ROLE, ApiContract
from seampact.codegen.runtime.replies import role_reply
from seampact.django.runtime.contract_replies import django_response
from seampact.ninja.views_mode import ViewsMode

PREFLIGHT_METHOD: Final = "OPTIONS"
_NOT_FOUND_STATUS: Final = 404

type PreflightView = Callable[[HttpRequest], HttpResponse] | Callable[[HttpRequest], Awaitable[HttpResponse]]


def unserved_preflight_view(contract: ApiContract, views: ViewsMode, path_view: Callable[..., object]) -> PreflightView:
    """The view of the api's views mode, since Ninja refuses a path whose views mix sync and async, with the signature
    of `path_view`, a contract view of the same path, so Ninja finds each path parameter."""

    def unserved(request: HttpRequest, **path_parameters: object) -> HttpResponse:
        return django_response(request, contract, role_reply(contract, None, NOT_FOUND_ROLE, _NOT_FOUND_STATUS))

    async def unserved_async(request: HttpRequest, **path_parameters: object) -> HttpResponse:
        return unserved(request)

    view = unserved_async if views is ViewsMode.ASYNC else unserved
    # Ninja reads a view's parameters through `inspect.signature`, which honours `__signature__`.
    setattr(view, "__signature__", inspect.signature(path_view))  # noqa: B010

    return view
