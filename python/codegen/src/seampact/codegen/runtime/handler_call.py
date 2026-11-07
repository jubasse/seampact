"""How an async placement calls a handler or hook method (ADR 0026 "Sync and async"): an `async def` on the event
loop, a plain `def` through the framework's thread runner (Starlette's threadpool, Django's `sync_to_async`), then
what a `def` returns awaited when it is awaitable."""

import inspect
from collections.abc import Awaitable, Callable
from typing import Protocol


class ThreadRunner(Protocol):
    """Runs a plain `def` off the event loop and gives back its result."""

    def __call__[A, R](self, method: Callable[[A], R], argument: A, /) -> Awaitable[R]: ...


async def call_handler_in[A, T](method: Callable[[A], T | Awaitable[T]], argument: A, run_in_thread: ThreadRunner) -> T:
    if inspect.iscoroutinefunction(method):
        # `iscoroutinefunction` narrows `method` to a coroutine function returning Any; its declared arm is the
        # awaitable one, so the awaited value is taken as T.
        coroutine: Awaitable[T] = method(argument)
        return await coroutine

    result: T | Awaitable[T] = await run_in_thread(method, argument)

    if isinstance(result, Awaitable):
        # The checkers read `Awaitable[Any]` here, since T might be awaitable itself: a plain `def` returning an
        # awaitable takes the `Awaitable[T]` arm its protocol declares, so the awaited value is taken as that T.
        awaited: T = await result
        return awaited

    return result
