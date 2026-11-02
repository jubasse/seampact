"""`bind_api`, which each generated `bind_<api>()` calls last (ADR 0026 "Placement"): it takes the api's router with
its contract routes, the app (the target, or `app=` when the target is an `APIRouter`), the hook factories and the
run-time settings. This release checks the call and refuses by name before it changes the app: the boundary, the
access and input dependencies, the exception map and the boot check come with the next release."""

import fastapi

from seampact.fastapi.runtime.placement import ApiPlacement, BindTarget, HookFactories, RunSettings
from seampact.fastapi.runtime.unavailable import PlacementUnavailableError

_BOUNDARY_PIECE = "the boundary middleware, the exception map and the boot check"


class BindingError(TypeError):
    """`bind_<api>()` called in a way that cannot place the api; the message names the fix."""


def bind_api(
    placement: ApiPlacement,
    target: BindTarget,
    router: fastapi.APIRouter,
    *,
    app: fastapi.FastAPI | None,
    hooks: HookFactories,
    settings: RunSettings,
) -> None:
    _app_of(placement, target, app)
    _refuse_unknown_operations(placement, settings)

    raise PlacementUnavailableError(placement.api, _BOUNDARY_PIECE)


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


def _refuse_unknown_operations(placement: ApiPlacement, settings: RunSettings) -> None:
    known = {route.operation_id for route in placement.routes}
    unknown = sorted(set(settings.operations) - known)

    if unknown:
        raise BindingError(
            f"seampact: bind_{placement.api}() got settings for operations the api does not keep: "
            f"{', '.join(unknown)}. Remove them from `operations=`, or correct their operation ids."
        )
