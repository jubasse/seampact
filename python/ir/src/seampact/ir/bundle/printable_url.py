"""A source URL as a diagnostic may print it, as `printable-url.ts`: the user name, the password, the query and the
fragment are dropped, since a token in them would land in CI logs. Text that is not an absolute URL (an scp-like git
address, a path) is printed as written; a URL with no host is not printable and loses its authority."""

import re
from typing import Final
from urllib.parse import urlsplit

# WHATWG strips C0 controls and spaces at both ends, removes tab, CR and LF anywhere, and reads `https:/` or
# `https:\\` as `https://`, so the text fallback does too.
_C0_CONTROL_OR_SPACE: Final = "".join(chr(code) for code in range(0x21))
_TAB_OR_NEWLINE: Final = re.compile(r"[\t\n\r]")
_SCHEME_PREFIX: Final = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*:")
_AUTHORITY_SLASHES: Final = re.compile(r"[/\\]*")
_QUERY_OR_FRAGMENT: Final = re.compile(r"[?#]")
_ABSOLUTE_URL: Final = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")

# The special schemes' default ports, which WHATWG drops from a URL.
_DEFAULT_PORTS: Final = {"http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21}


def printable_url(text: str) -> str:
    cleaned = _TAB_OR_NEWLINE.sub("", text.strip(_C0_CONTROL_OR_SPACE))

    if _ABSOLUTE_URL.match(cleaned) is None:
        return _redacted_by_text(cleaned) if _SCHEME_PREFIX.match(cleaned) else text

    try:
        parts = urlsplit(cleaned)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return _redacted_by_text(cleaned)

    if not parts.scheme or not host:
        return _redacted_by_text(cleaned)

    scheme = parts.scheme.lower()
    shown_host = f"[{host}]" if ":" in host else host.lower()
    shown_port = "" if port is None or port == _DEFAULT_PORTS.get(scheme) else f":{port}"
    path = parts.path or "/"

    return f"{scheme}://{shown_host}{shown_port}{path}"


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

    return text[:scheme_end] + slashes_text + without_query
