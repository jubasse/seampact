"""The FastAPI placement runtime the generated code imports (ADR 0026 "What the generated code depends on"): the
declarations of one api's placement, its contract routes, the handler call, and `bind_api`. The framework-neutral steps
come from `seampact.codegen.runtime`."""

from seampact.codegen.runtime.reply_verdict import FrameworkEtagMode, ResponsesMode
from seampact.fastapi.runtime.binding import BindingError, bind_api
from seampact.fastapi.runtime.placement import (
    ApiPlacement,
    App,
    BindTarget,
    BootCheckSwitches,
    Factory,
    FrameworkRouteRule,
    FrameworkRoutesCheck,
    HookFactories,
    HooksCheck,
    OperationRoute,
    OperationSettings,
    RunSettings,
    TargetDefaults,
)
from seampact.fastapi.runtime.routes import add_operation, call_handler, contract_router
from seampact.fastapi.runtime.unavailable import PLACEMENT_UNAVAILABLE, PlacementUnavailableError

__all__ = [
    "PLACEMENT_UNAVAILABLE",
    "ApiPlacement",
    "App",
    "BindTarget",
    "BindingError",
    "BootCheckSwitches",
    "Factory",
    "FrameworkEtagMode",
    "FrameworkRouteRule",
    "FrameworkRoutesCheck",
    "HookFactories",
    "HooksCheck",
    "OperationRoute",
    "OperationSettings",
    "PlacementUnavailableError",
    "ResponsesMode",
    "RunSettings",
    "TargetDefaults",
    "add_operation",
    "bind_api",
    "call_handler",
    "contract_router",
]
