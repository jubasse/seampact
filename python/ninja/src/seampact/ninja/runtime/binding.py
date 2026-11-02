"""What `bind_<api>()` hands the runtime: the api's binding, one `add_operation` per contract operation with its view
and handler call, then `bind_api`. This release records the operations and refuses `bind_api` by name, before the
app changes; the views refuse likewise."""

import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Final

from asgiref.sync import sync_to_async
from django.http import HttpRequest, HttpResponse
from ninja import NinjaAPI

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.run_settings import OperationTypes, RunSettings
from seampact.hooks import AuthenticateHook, DecideHook, IdempotencyStore, ResolveScopeHook, UnexpectedErrorListener
from seampact.ninja.runtime.placement import AccessSettings, ApiPlacement, Factory, OperationRoute
from seampact.ninja.runtime.unavailable import PlacementUnavailableError

_ROUTER_PIECE: Final = "the api's Router and its views"


class BindingError(TypeError):
    """`bind_<api>()` was given a value it cannot use; the message names it and the fix."""


@dataclass(frozen=True, slots=True)
class BoundOperation:
    route: OperationRoute
    view: Callable[..., object]
    handlers: Factory[object] | None
    call: Callable[..., object]
    types: OperationTypes


@dataclass(slots=True, kw_only=True)
class ApiBinding:
    placement: ApiPlacement
    contract: ApiContract
    api: NinjaAPI
    prefix: str
    authenticate: Mapping[str, Factory[AuthenticateHook]]
    deciders: Mapping[str, Factory[DecideHook]]
    scope_resolvers: Mapping[str, Factory[ResolveScopeHook]]
    idempotency_store: Factory[IdempotencyStore] | None
    on_unexpected_error: Factory[UnexpectedErrorListener] | None
    access: Mapping[str, AccessSettings]
    settings: RunSettings
    operations: dict[str, BoundOperation] = field(default_factory=dict)


def api_binding(
    placement: ApiPlacement,
    contract: ApiContract,
    api: NinjaAPI,
    *,
    prefix: str,
    authenticate: Mapping[str, Factory[AuthenticateHook]],
    deciders: Mapping[str, Factory[DecideHook]],
    scope_resolvers: Mapping[str, Factory[ResolveScopeHook]],
    idempotency_store: Factory[IdempotencyStore] | None,
    on_unexpected_error: Factory[UnexpectedErrorListener] | None,
    access: Mapping[str, AccessSettings],
    settings: RunSettings,
) -> ApiBinding:
    """Raises `BindingError` when `api` is not a `NinjaAPI`."""
    if not isinstance(api, NinjaAPI):
        raise BindingError(
            f"seampact: bind_{placement.api}() takes the app's NinjaAPI, not a {type(api).__qualname__}; pass the "
            "NinjaAPI whose urls the app includes."
        )

    return ApiBinding(
        placement=placement,
        contract=contract,
        api=api,
        prefix=prefix,
        authenticate=dict(authenticate),
        deciders=dict(deciders),
        scope_resolvers=dict(scope_resolvers),
        idempotency_store=idempotency_store,
        on_unexpected_error=on_unexpected_error,
        access=dict(access),
        settings=settings,
    )


def add_operation[E, R](
    binding: ApiBinding,
    operation_id: str,
    view: Callable[..., object],
    handlers: Factory[E] | None,
    call: Callable[[E, R], object],
    types: OperationTypes,
) -> None:
    """Records one contract operation: its route, its view, the factory of its endpoints and its handler call."""
    binding.operations[operation_id] = BoundOperation(
        binding.placement.route(operation_id), view, handlers, call, types
    )


def bind_api(binding: ApiBinding) -> None:
    """Raises `PlacementUnavailableError` before the app changes: this release declares the api, the next serves it."""
    raise PlacementUnavailableError(binding.placement.api, _ROUTER_PIECE)


def serve_operation(request: HttpRequest, placement: ApiPlacement, operation_id: str) -> HttpResponse:
    """The body of a sync contract view."""
    raise PlacementUnavailableError(placement.api, _ROUTER_PIECE)


async def serve_operation_async(request: HttpRequest, placement: ApiPlacement, operation_id: str) -> HttpResponse:
    """The body of an async contract view."""
    raise PlacementUnavailableError(placement.api, _ROUTER_PIECE)


def call_handler[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
    """Calls a handler method from a sync view; raises `TypeError` for an `async def` method, which sync views do not
    run (the boot check refuses it first)."""
    if inspect.iscoroutinefunction(method):
        raise TypeError(
            f"seampact: the handler method {method.__qualname__} is `async def`, and the api's views are sync; "
            "make it a plain `def`, or generate with the target option `views: async`."
        )

    result = method(argument)

    if isinstance(result, Awaitable):
        raise TypeError(
            f"seampact: the handler method {method.__qualname__} returned an awaitable from a sync view; return the "
            "result itself, or generate with the target option `views: async`."
        )

    return result


async def call_handler_async[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
    """Calls a handler method from an async view: an `async def` method is awaited, a plain `def` runs through
    `sync_to_async`."""
    if inspect.iscoroutinefunction(method):
        coroutine: Awaitable[T] = method(argument)
        return await coroutine

    result: T | Awaitable[T] = await sync_to_async(method)(argument)

    if isinstance(result, Awaitable):
        awaited: T = await result
        return awaited

    return result
