"""The Django runtime of generated code: the boundary middleware every api's generated boundary derives from, and the
handler factories an api reads from `settings.SEAMPACT`. What a later release of seampact-django brings is refused
by name when Django builds the middleware or a contract view runs, never served half done."""

from seampact.django.runtime.boundary import ContractBoundary
from seampact.django.runtime.handler_factories import HandlersMismatchError, built_handlers
from seampact.django.runtime.unavailable import PLACEMENT_UNAVAILABLE, PlacementUnavailableError

__all__ = [
    "PLACEMENT_UNAVAILABLE",
    "ContractBoundary",
    "HandlersMismatchError",
    "PlacementUnavailableError",
    "built_handlers",
]
