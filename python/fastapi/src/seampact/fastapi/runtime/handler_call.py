"""How the runtime calls a handler or hook method (ADR 0026 "Sync and async"): an `async def` on the event loop, a
plain `def` in Starlette's threadpool, which carries the caller's context variables, then awaits what a `def` returns
when it is awaitable."""

import inspect
from collections.abc import Awaitable, Callable

from starlette.concurrency import run_in_threadpool


async def call_handler[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
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
