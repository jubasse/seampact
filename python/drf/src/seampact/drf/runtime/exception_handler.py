"""The exception handler of the contract views (ADR 0027 "DRF", "Exceptions"): each view returns its api's handler
from `get_exception_handler()`, so the app's `EXCEPTION_HANDLER` never applies to a contract route."""

from collections.abc import Callable, Mapping

from django.http import HttpResponseBase

from seampact.django.runtime import PlacementUnavailableError

type ExceptionHandler = Callable[[Exception, Mapping[str, object]], HttpResponseBase | None]


def contract_exception_reply(api: str, exception: Exception, context: Mapping[str, object]) -> HttpResponseBase | None:
    """The contract reply for an exception a contract view raised."""
    raise PlacementUnavailableError(
        f"The DRF exception map of api '{api}', for a {type(exception).__name__} in {context.get('view')!r},"
    ) from exception
