"""The Ninja placement runtime the generated code imports (ADR 0027 "Ninja"): the declarations of one api's placement,
its binding and Router, its boundary middleware, the body of its views and their handler calls. The
framework-neutral steps come from `seampact.codegen.runtime` and the shared boundary from `seampact.django.runtime`."""

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.codegen.runtime.reply_verdict import ResponsesMode
from seampact.codegen.runtime.run_settings import OperationSettings, OperationTypes, RunSettings
from seampact.ninja.runtime.binding import ApiBinding, BindingError, add_operation, api_binding, bind_api
from seampact.ninja.runtime.boundary import NinjaContractBoundary
from seampact.ninja.runtime.placement import AccessSettings, ApiPlacement, Factory, NinjaAuth, OperationRoute, ViewsMode
from seampact.ninja.runtime.views import (
    async_handler_error,
    call_handler_async,
    serve_operation,
    serve_operation_async,
)

__all__ = [
    "AccessSettings",
    "ApiBinding",
    "ApiPlacement",
    "BindingError",
    "CredentialsType",
    "Factory",
    "NinjaAuth",
    "NinjaContractBoundary",
    "OperationRoute",
    "OperationSettings",
    "OperationTypes",
    "ResponsesMode",
    "RunSettings",
    "ViewsMode",
    "add_operation",
    "api_binding",
    "async_handler_error",
    "bind_api",
    "call_handler_async",
    "serve_operation",
    "serve_operation_async",
]
