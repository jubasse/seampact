"""A source URL as a diagnostic may print it, as `printable-url.ts`: the user name, the password, the query and the
fragment are dropped, since a token in them would land in CI logs. Text that is not an absolute URL with a host (an
scp-like git address, a path) is printed as written."""

import re
from typing import Final
from urllib.parse import urlsplit

_SCHEME: Final = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")


def printable_url(text: str) -> str:
    if _SCHEME.match(text) is None:
        return text

    try:
        parts = urlsplit(text)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return text

    if not parts.scheme or not host:
        return text

    shown_port = f":{port}" if port is not None else ""
    path = parts.path or "/"

    return f"{parts.scheme.lower()}://{host.lower()}{shown_port}{path}"
