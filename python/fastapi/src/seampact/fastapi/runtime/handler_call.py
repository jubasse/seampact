"""How the FastAPI runtime calls a handler or hook method (ADR 0026 "Sync and async"): the shared call, with a plain
`def` run in Starlette's threadpool, which carries the caller's context variables."""

from collections.abc import Awaitable, Callable

from starlette.concurrency import run_in_threadpool

from seampact.codegen.runtime.handler_call import call_handler_in


async def _in_threadpool[A, R](method: Callable[[A], R], argument: A) -> R:
    return await run_in_threadpool(method, argument)


async def call_handler[A, T](method: Callable[[A], T | Awaitable[T]], argument: A) -> T:
    return await call_handler_in(method, argument, _in_threadpool)
