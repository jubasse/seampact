"""A CORS preflight: an `OPTIONS` request with `Origin` and `Access-Control-Request-Method`, which no contract
operation declares. A boundary leaves it to the app's CORS layer, as the PHP boundaries do, rather than answering the
path's 404 for a method the path does not serve."""

from collections.abc import Iterable
from typing import Final

_PREFLIGHT_METHOD: Final = "OPTIONS"
_ORIGIN: Final = "origin"
_REQUESTED_METHOD: Final = "access-control-request-method"


def is_cors_preflight(method: str, header_names: Iterable[str]) -> bool:
    """`header_names` in any case; the method as sent, since HTTP methods are case-sensitive."""
    if method != _PREFLIGHT_METHOD:
        return False

    names = {name.lower() for name in header_names}

    return _ORIGIN in names and _REQUESTED_METHOD in names
