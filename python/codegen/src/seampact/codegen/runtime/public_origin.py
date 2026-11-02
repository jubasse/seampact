"""The origin absolute URLs start with (`api.wire.urls: absolute`): a scheme, a host and an optional port, from the
app's configuration (FastAPI's `public_origin` argument, Django's `public_origin` setting). The request's `Host` and
forwarded headers are never read. The boot check's item names the setting and the fix."""

import re
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_string

_ABSOLUTE_URLS: Final = "absolute"
_SCHEMES: Final = ("http", "https")
_SCHEME_SEPARATOR: Final = "://"
_USER_INFO_SEPARATOR: Final = "@"
_AUTHORITY_END: Final = re.compile(r"[/?#]")
# What Java's `URI` reads as a server authority: a DNS name or IPv4 address, or a bracketed IPv6 address, then an
# optional port of digits.
_HOST_AND_PORT: Final = re.compile(
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*"
    r"|\[[0-9A-Fa-f:.]+\])"
    r"(?::(?P<port>[0-9]{1,5}))?"
)
_LOWEST_PORT: Final = 1
_HIGHEST_PORT: Final = 65535
_EXAMPLE: Final = "https://api.example.com"


def writes_absolute_urls(contract: ApiContract) -> bool:
    return ir_string(ir_map(ir_map(contract.ir_view, "api"), "wire"), "urls") == _ABSOLUTE_URLS


def configured_origin(contract: ApiContract, configured: object) -> str | None:
    """The configured origin under absolute URLs; None under relative ones, or when the boot check refuses it."""
    if not writes_absolute_urls(contract) or not isinstance(configured, str) or _problem_of(configured) is not None:
        return None

    return configured


def public_origin_problem(contract: ApiContract, setting: str, configured: object) -> str | None:
    """The boot check's problem with the origin set in `setting`: one set under relative URLs, or a missing or invalid
    one under absolute URLs."""
    is_set = configured is not None and configured != ""

    if not writes_absolute_urls(contract):
        if not is_set:
            return None

        return (
            f"the api '{contract.api}' writes relative URLs ('api.wire.urls: relative') and {setting} is set: remove "
            "it, or set 'api.wire.urls: absolute' to write absolute URLs"
        )

    if not is_set:
        return (
            f"the api '{contract.api}' writes absolute URLs ('api.wire.urls: absolute') and {setting} is not set: set "
            f"it to the origin clients call, such as {_EXAMPLE}"
        )

    problem = _problem_of(configured) if isinstance(configured, str) else "is not a string"

    if problem is None:
        return None

    # The value is shown by its repr, so a line break or a control character never reaches the log line raw.
    shown = repr(configured) if isinstance(configured, str) else type(configured).__qualname__

    return (
        f"{setting} is {shown}, which {problem}: set a scheme (http or https), a host and an optional port, such as "
        f"{_EXAMPLE}"
    )


def _problem_of(configured: str) -> str | None:
    scheme, separator, rest = configured.partition(_SCHEME_SEPARATOR)

    if separator == "" or scheme not in _SCHEMES:
        return "has no http or https scheme"

    end = _AUTHORITY_END.search(rest)
    authority = rest if end is None else rest[: end.start()]

    if _USER_INFO_SEPARATOR in authority:
        return "carries user info"

    if authority != rest:
        return "has a path, a query or a fragment (a trailing slash included)"

    if authority == "":
        return "has no host"

    host_and_port = _HOST_AND_PORT.fullmatch(authority)

    if host_and_port is None:
        return "has a host that is not a DNS name, an IPv4 address or a bracketed IPv6 address, or an empty port"

    port = host_and_port.group("port")

    if port is not None and not _LOWEST_PORT <= int(port) <= _HIGHEST_PORT:
        return f"has a port outside {_LOWEST_PORT}-{_HIGHEST_PORT}"

    return None
