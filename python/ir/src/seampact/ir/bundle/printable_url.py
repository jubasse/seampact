"""A source URL as a diagnostic may print it, as `printable-url.ts`: the user name, the password, the query and the
fragment are dropped, since a token in them would land in CI logs. Text that is not an absolute URL (an scp-like git
address, a path) is printed as written; a URL with no host is not printable and loses its authority."""

import re
from typing import Final
from urllib.parse import urlsplit

# WHATWG skips leading spaces and reads `https:/` or `https:\\` as `https://`, so the text fallback does too.
_SCHEME_PREFIX: Final = re.compile(r"[\t\n\r ]*[A-Za-z][A-Za-z0-9+.-]*:")
_AUTHORITY_SLASHES: Final = re.compile(r"[/\\]*")
_QUERY_OR_FRAGMENT: Final = re.compile(r"[?#]")
_ABSOLUTE_URL: Final = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")


def printable_url(text: str) -> str:
    stripped = text.lstrip("\t\n\r ")

    if _ABSOLUTE_URL.match(stripped) is None:
        return _redacted_by_text(text) if _SCHEME_PREFIX.match(text) else text

    try:
        parts = urlsplit(stripped)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return _redacted_by_text(text)

    if not parts.scheme or not host:
        return _redacted_by_text(text)

    shown_port = f":{port}" if port is not None else ""
    path = parts.path or "/"

    return f"{parts.scheme.lower()}://{host.lower()}{shown_port}{path}"


def _redacted_by_text(text: str) -> str:
    """A URL that does not parse (a bad port, a bad bracket, no host) still may hold a token. Everything up to the last
    `@` goes first, since a password may hold a raw `?` or `#`; an `@` in the query then drops more than needed, never
    less."""
    scheme_end = text.index(":") + 1
    after_scheme = text[scheme_end:]
    slashes = _AUTHORITY_SLASHES.match(after_scheme)
    slashes_text = "" if slashes is None else slashes.group()
    authority_and_rest = after_scheme[len(slashes_text) :]
    without_user = authority_and_rest.rpartition("@")[2]
    without_query = _QUERY_OR_FRAGMENT.split(without_user, maxsplit=1)[0]

    return text[:scheme_end].lstrip("\t\n\r ") + slashes_text + without_query
