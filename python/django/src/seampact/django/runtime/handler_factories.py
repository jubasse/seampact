"""The handler factories of an api (ADR 0027 "Settings"): `settings.SEAMPACT["<api>"]["handlers"]` names, per
resource, the dotted path of a callable that builds the resource's handlers from the `HttpRequest`. The generated
code checks what a factory built against the resource's protocol."""

from django.http import HttpRequest

from seampact.django.runtime.unavailable import PlacementUnavailableError


class HandlersMismatchError(TypeError):
    """A handler factory built an object without the methods of the resource's protocol."""

    def __init__(self, api: str, resource: str, protocol: str, built: object) -> None:
        super().__init__(
            f"seampact: the handler factory of resource '{resource}' of api '{api}' built a "
            f"{type(built).__qualname__}, which does not implement {protocol}. Return an object with every method "
            f"of {protocol} from the factory that settings.SEAMPACT['{api}']['handlers']['{resource}'] names."
        )


def built_handlers(api: str, resource: str, request: HttpRequest) -> object:
    """What the factory of `resource` builds for this request."""
    raise PlacementUnavailableError(
        f"Building the handlers of resource '{resource}' of api '{api}' for a {request.method} request"
    )
