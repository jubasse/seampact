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
        return _redacted_by_text(text)

    if not parts.scheme or not host:
        return text

    shown_port = f":{port}" if port is not None else ""
    path = parts.path or "/"

    return f"{parts.scheme.lower()}://{host.lower()}{shown_port}{path}"


def _redacted_by_text(text: str) -> str:
    """A URL that does not parse (a bad port, a bad bracket) still may hold a token: drop the query, the fragment, and
    everything from the scheme's `//` to the last `@`, by text."""
    scheme_end = text.index("://") + len("://")
    without_query = re.split(r"[?#]", text[scheme_end:], maxsplit=1)[0]
    without_user = without_query.rpartition("@")[2]

    return text[:scheme_end] + without_user
