"""Runs a step written as a coroutine from sync code (a WSGI placement): the step must finish without suspending,
since there is no event loop to resume it; a suspension is the boundary's own failure, answered with the api's 500."""

import inspect
from collections.abc import Awaitable, Callable, Coroutine

from seampact.codegen.runtime.failures import BoundaryFailureError


def run_without_suspension[T](step: Coroutine[object, object, T]) -> T:
    """Raises `BoundaryFailureError` when the step suspends, naming the awaitable it waited on."""
    try:
        awaited = step.send(None)
    except StopIteration as finished:
        result: T = finished.value
        return result

    step.close()

    raise BoundaryFailureError(
        f"seampact: a boundary step suspended on {awaited!r} under a sync placement; a hook or handler the sync "
        "placement calls must be a plain def, or run the app under ASGI."
    )


async def call_without_suspension[A, T](method: Callable[[A], T | Awaitable[T]], argument: A, /) -> T:
    """The hook caller of a sync placement: a `def` answers at once, an `async def` is awaited in the same step, and
    `run_without_suspension` refuses it by name when it suspends."""
    answer = method(argument)

    if inspect.isawaitable(answer):
        awaited: T = await answer
        return awaited

    return answer
