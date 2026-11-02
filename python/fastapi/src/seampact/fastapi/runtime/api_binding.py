"""One api's binding to an app, which `bind_<api>()` builds first: the placement and the contract the generated code
declares, the app and the target router, the hook and handler factories, the run-time settings resolved against the
target options, the api's router, and what the boot check found. The boundary, the dependencies, the exception map and
the boot check all read it."""

import inspect
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TypeGuard

import fastapi

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.reply_verdict import ResponsesMode
from seampact.fastapi.runtime.placement import ApiPlacement, BindTarget, Factory, HookFactories, RunSettings
from seampact.hooks import UnexpectedErrorListener, UnexpectedFailure


class BindingError(TypeError):
    """`bind_<api>()` called in a way that cannot place the api; the message names the fix."""


@dataclass(slots=True, kw_only=True)
class ApiBinding:
    """`boot_problems` is None until the boot check ran; `route_entry` is what `target.routes` gained when the api's
    router was included; `dependencies` are the generated access and input dependencies an override must not
    replace."""

    placement: ApiPlacement
    contract: ApiContract
    app: fastapi.FastAPI
    target: BindTarget
    hooks: HookFactories
    settings: RunSettings
    router: fastapi.APIRouter = field(default_factory=fastapi.APIRouter)
    handler_factories: dict[str, Factory[object] | None] = field(default_factory=dict)
    dependencies: list[Callable[..., object]] = field(default_factory=list)
    route_entry: object | None = None
    wrapped_handlers: dict[object, object] = field(default_factory=dict)
    boot_problems: list[str] | None = None

    @property
    def api(self) -> str:
        return self.placement.api

    @property
    def logger(self) -> logging.Logger:
        return logging.getLogger(f"seampact.{self.api}")

    def responses(self, operation_id: str | None) -> ResponsesMode:
        """The operation's mode wins over the api's, which wins over the target option."""
        operation = None if operation_id is None else self.settings.operations.get(operation_id)

        if operation is not None and operation.responses is not None:
            return operation.responses

        return self.settings.responses or self.placement.defaults.responses

    async def tell_listener(
        self,
        operation_id: str | None,
        reason: str,
        cause: BaseException | None,
        listener: UnexpectedErrorListener | None,
    ) -> None:
        """Logs the failure and tells the api's unexpected-error listener; a listener that fails is logged too, never
        raised, since the reply is the api's 500 whatever it does."""
        self.logger.error(
            "seampact: the '%s' boundary answered its 500 on operation '%s': %s", self.api, operation_id, reason
        )
        await self.notify_listener(operation_id, reason, cause, listener)

    async def tell_store_failure(
        self, operation_id: str, reason: str, cause: BaseException, listener: UnexpectedErrorListener | None
    ) -> None:
        """A store that failed after the reply was decided: the reply stands, the failure is logged and heard."""
        self.logger.error("seampact: the '%s' boundary on operation '%s': %s", self.api, operation_id, reason)
        await self.notify_listener(operation_id, reason, cause, listener)

    async def notify_listener(
        self,
        operation_id: str | None,
        reason: str,
        cause: BaseException | None,
        listener: UnexpectedErrorListener | None,
    ) -> None:
        heard = listener if listener is not None else self._listener_without_dependencies()

        if heard is None:
            return

        try:
            outcome = heard.on_unexpected_error(
                UnexpectedFailure(api=self.api, operation=operation_id, reason=reason, cause=cause)
            )

            if inspect.isawaitable(outcome):
                await outcome
        except Exception:
            self.logger.exception("seampact: the unexpected-error listener of the '%s' api failed", self.api)

    def _listener_without_dependencies(self) -> UnexpectedErrorListener | None:
        """The listener built outside FastAPI's dependency resolution, for a failure before the access dependency ran:
        only a factory that needs no dependency can be called there."""
        factory = self.hooks.on_unexpected_error

        if factory is None:
            return None

        required = [
            parameter
            for parameter in inspect.signature(factory).parameters.values()
            if parameter.default is inspect.Parameter.empty
        ]

        if required or inspect.iscoroutinefunction(factory) or inspect.isgeneratorfunction(factory):
            self.logger.error(
                "seampact: the '%s' api's on_unexpected_error factory takes dependencies, so a failure before the "
                "access dependency cannot reach it; give it a factory without parameters.",
                self.api,
            )
            return None

        built = factory()

        return built if is_unexpected_error_listener(built) else None


def is_unexpected_error_listener(value: object) -> TypeGuard[UnexpectedErrorListener]:
    return callable(getattr(value, "on_unexpected_error", None))


def api_binding(
    placement: ApiPlacement,
    contract: ApiContract,
    target: BindTarget,
    *,
    app: fastapi.FastAPI | None,
    hooks: HookFactories,
    settings: RunSettings,
) -> ApiBinding:
    """Raises `BindingError` when the app cannot be told or `operations=` names an operation the api does not keep."""
    bound_app = _app_of(placement, target, app)
    known = {route.operation_id for route in placement.routes}
    unknown = sorted(set(settings.operations) - known)

    if unknown:
        raise BindingError(
            f"seampact: bind_{placement.api}() got settings for operations the api does not keep: "
            f"{', '.join(unknown)}. Remove them from `operations=`, or correct their operation ids."
        )

    return ApiBinding(
        placement=placement, contract=contract, app=bound_app, target=target, hooks=hooks, settings=settings
    )


def _app_of(placement: ApiPlacement, target: BindTarget, app: fastapi.FastAPI | None) -> fastapi.FastAPI:
    """The app the boundary and the exception handlers belong to."""
    if isinstance(target, fastapi.FastAPI):
        if app is not None and app is not target:
            raise BindingError(
                f"seampact: bind_{placement.api}() got an app as its target and another app as `app=`. Pass the app "
                "once, as the target."
            )

        return target

    if app is None:
        raise BindingError(
            f"seampact: bind_{placement.api}() got an APIRouter as its target without `app=`: the boundary and the "
            "exception handlers belong to the app. Pass `app=<your FastAPI app>`, and include the router after the "
            "call."
        )

    return app
