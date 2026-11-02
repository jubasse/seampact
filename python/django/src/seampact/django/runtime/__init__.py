"""The Django runtime of generated code: the boundary middleware every api's generated boundary derives from, its
per-request state, the replies it writes, the boot check, and the handler factories an api reads from
`settings.SEAMPACT`. What a later release of seampact-django brings is refused by name, never served half done."""

from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import AcceptedFramework, VersionUnit
from seampact.django.runtime.boundary import ContractBoundary
from seampact.django.runtime.handler_factories import HandlersMismatchError, built_handlers

__all__ = [
    "AcceptedFramework",
    "ContractBoundary",
    "FrameworkRouteRule",
    "HandlersMismatchError",
    "VersionUnit",
    "built_handlers",
]
