"""The contract routes of one api (ADR 0026 "Routes"): one `add_api_route` per operation on the api's own router, named
`seampact.<api>.<operationId>`, left out of FastAPI's document, with the access dependency on the route and an
endpoint that takes only the `Request`, the input dependency and the handler factory, in that order, so FastAPI parses
no parameter."""

import inspect
from collections.abc import Awaitable, Callable
from typing import Annotated, NoReturn

import fastapi
from starlette.concurrency import run_in_threadpool

from seampact.fastapi.runtime.placement import ApiPlacement, Factory, OperationRoute
from seampact.fastapi.runtime.unavailable import PlacementUnavailableError

_ACCESS_PIECE = "the access dependency (steps 2 to 5)"
_INPUT_PIECE = "the input dependency (steps 6 to 8)"
_REPLY_PIECE = "the reply of a handler's result"


def contract_router() -> fastapi.APIRouter:
    """The api's router: no prefix, since `mount` is already in each path. The app's router does the routing, so a
    trailing slash is the boundary's to answer, not this router's."""
    return fastapi.APIRouter()


def add_operation[E, R](
    router: fastapi.APIRouter,
    placement: ApiPlacement,
    operation_id: str,
    handlers: Factory[E],
    invoke: Callable[[E, R], Awaitable[object]],
) -> None:
    """Adds the contract route of `operation_id`, its endpoint calling `invoke` with the handlers `handlers` builds."""
    route = placement.route(operation_id)

    router.add_api_route(
        route.path,
        _endpoint(placement, route, handlers, invoke),
        methods=list(route.methods),
        name=route.name,
        include_in_schema=False,
        dependencies=[fastapi.Depends(_access_dependency(placement, route))],
        response_class=fastapi.Response,
    )


async def call_handler[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
    """Calls a handler or hook method: an `async def` on the event loop, a plain `def` in Starlette's threadpool,
    which carries the caller's context variables, then awaits what a `def` returns when it is awaitable."""
    if inspect.iscoroutinefunction(method):
        coroutine: Awaitable[T] = method(argument)
        return await coroutine

    result: T | Awaitable[T] = await run_in_threadpool(method, argument)

    if isinstance(result, Awaitable):
        # The checkers read `Awaitable[Any]` here, since T might be awaitable itself: a plain `def` returning an
        # awaitable takes the `Awaitable[T]` arm its protocol declares, so the awaited value is taken as that T.
        awaited: T = await result
        return awaited

    return result


def _access_dependency(placement: ApiPlacement, route: OperationRoute) -> Callable[[fastapi.Request], NoReturn]:
    def access(request: fastapi.Request) -> NoReturn:
        raise PlacementUnavailableError(placement.api, f"{_ACCESS_PIECE} of operation '{route.operation_id}'")

    return access


def _input_dependency(placement: ApiPlacement, route: OperationRoute) -> Callable[[fastapi.Request], NoReturn]:
    def contract_input(request: fastapi.Request) -> NoReturn:
        raise PlacementUnavailableError(placement.api, f"{_INPUT_PIECE} of operation '{route.operation_id}'")

    return contract_input


def _endpoint[E, R](
    placement: ApiPlacement,
    route: OperationRoute,
    handlers: Factory[E],
    invoke: Callable[[E, R], Awaitable[object]],
) -> Callable[..., Awaitable[fastapi.Response]]:
    input_dependency = _input_dependency(placement, route)

    async def endpoint(
        request: fastapi.Request,
        contract_request: Annotated[R, fastapi.Depends(input_dependency)],
        endpoints: Annotated[E, fastapi.Depends(handlers)],
    ) -> fastapi.Response:
        await invoke(endpoints, contract_request)

        raise PlacementUnavailableError(placement.api, f"{_REPLY_PIECE} of operation '{route.operation_id}'")

    endpoint.__name__ = f"seampact_{placement.api}_{route.operation_id}"

    return endpoint
