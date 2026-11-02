"""The FastAPI placement runtime the generated code imports (ADR 0026 "What the generated code depends on"): the
declarations of one api's placement, its binding, its contract routes with the access and input dependencies, the
boundary middleware, the exception map and the boot check. The framework-neutral steps come from
`seampact.codegen.runtime`."""

from seampact.codegen.runtime.access_steps import CredentialsType
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import AcceptedFramework, VersionUnit
from seampact.codegen.runtime.reply_verdict import FrameworkEtagMode, ResponsesMode
from seampact.fastapi.runtime.api_binding import ApiBinding, BindingError, api_binding
from seampact.fastapi.runtime.binding import bind_api
from seampact.fastapi.runtime.boot_check import BootCheckError
from seampact.fastapi.runtime.boundary import ContractBoundary
from seampact.fastapi.runtime.handler_call import call_handler
from seampact.fastapi.runtime.handler_reply import OperationTypes
from seampact.fastapi.runtime.native_docs import FrameworkDocs, NativeDocsError, read_native_docs
from seampact.fastapi.runtime.placement import (
    ApiPlacement,
    App,
    BindTarget,
    BootCheckSwitches,
    Factory,
    FrameworkRoutesCheck,
    HookFactories,
    HooksCheck,
    OperationRoute,
    OperationSettings,
    RunSettings,
    TargetDefaults,
)
from seampact.fastapi.runtime.routes import add_operation

__all__ = [
    "AcceptedFramework",
    "ApiBinding",
    "ApiPlacement",
    "App",
    "BindTarget",
    "BindingError",
    "BootCheckError",
    "BootCheckSwitches",
    "ContractBoundary",
    "CredentialsType",
    "Factory",
    "FrameworkDocs",
    "FrameworkEtagMode",
    "FrameworkRouteRule",
    "FrameworkRoutesCheck",
    "HookFactories",
    "HooksCheck",
    "NativeDocsError",
    "OperationRoute",
    "OperationSettings",
    "OperationTypes",
    "ResponsesMode",
    "RunSettings",
    "TargetDefaults",
    "VersionUnit",
    "add_operation",
    "api_binding",
    "bind_api",
    "call_handler",
    "read_native_docs",
]
