"""The Ninja placement runtime the generated code imports (ADR 0027 "Ninja"): the declarations of one api's placement,
its binding, and the handler calls of its views. The framework-neutral steps come from `seampact.codegen.runtime` and
the boundary middleware from `seampact.django.runtime`."""

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.codegen.runtime.reply_verdict import ResponsesMode
from seampact.codegen.runtime.run_settings import OperationSettings, OperationTypes, RunSettings
from seampact.ninja.runtime.binding import (
    ApiBinding,
    BindingError,
    add_operation,
    api_binding,
    bind_api,
    call_handler,
    call_handler_async,
    serve_operation,
    serve_operation_async,
)
from seampact.ninja.runtime.placement import AccessSettings, ApiPlacement, Factory, NinjaAuth, OperationRoute, ViewsMode
from seampact.ninja.runtime.unavailable import PLACEMENT_UNAVAILABLE, PlacementUnavailableError

__all__ = [
    "PLACEMENT_UNAVAILABLE",
    "AccessSettings",
    "ApiBinding",
    "ApiPlacement",
    "BindingError",
    "CredentialsType",
    "Factory",
    "NinjaAuth",
    "OperationRoute",
    "OperationSettings",
    "OperationTypes",
    "PlacementUnavailableError",
    "ResponsesMode",
    "RunSettings",
    "ViewsMode",
    "add_operation",
    "api_binding",
    "bind_api",
    "call_handler",
    "call_handler_async",
    "serve_operation",
    "serve_operation_async",
]
