"""Runs a step written as a coroutine from sync code (a WSGI placement): the step must finish without suspending,
since there is no event loop to resume it; a suspension is the boundary's own failure, answered with the api's 500."""

from collections.abc import Coroutine

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
