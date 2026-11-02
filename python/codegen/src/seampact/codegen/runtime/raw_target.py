"""The raw request target as the client sent it, without its query: the ASGI `raw_path` (minus a raw prefix equal to
`root_path`), or the WSGI `RAW_URI` or `REQUEST_URI` (minus `SCRIPT_NAME`). A server that gives no raw target leaves
the decoded path, marked so the boundary logs once which raw-path rules it cannot apply."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

# An absolute-form request target (`http://host/path`) keeps only its path.
_ORIGIN: Final = re.compile(r"^[a-z][a-z0-9+.-]*://[^/]*", re.IGNORECASE)
# ASGI and WSGI carry raw bytes as Latin-1 text, one character per byte.
_BYTES_AS_TEXT: Final = "latin-1"


@dataclass(frozen=True, slots=True)
class RawTarget:
    """`path` starts with `/`; `query` is the raw query string; `raw` is False when the server gave no raw target
    and `path` is the decoded one."""

    path: str
    query: str
    raw: bool


def asgi_raw_target(scope: Mapping[str, object]) -> RawTarget | None:
    """None when `root_path` is set and the target does not start with it: the request is not a contract request."""
    raw_path = scope.get("raw_path")
    query = scope.get("query_string")
    query_text = query.decode(_BYTES_AS_TEXT) if isinstance(query, bytes) else ""

    if isinstance(raw_path, bytes):
        path = _without_query(raw_path.decode(_BYTES_AS_TEXT))
        root = _raw_text(_text(scope, "root_path"))
        raw = True
    else:
        path = _text(scope, "path")
        root = _text(scope, "root_path")
        raw = False

    path = _without_origin(path)

    if root == "":
        return RawTarget(_rooted(path), query_text, raw)

    stripped = _stripped_prefix(path, root)

    return None if stripped is None else RawTarget(_rooted(stripped), query_text, raw)


def wsgi_raw_target(environ: Mapping[str, object]) -> RawTarget:
    """The raw target minus `SCRIPT_NAME`; under a server that gives no `RAW_URI` or `REQUEST_URI` (Django's
    `runserver`), the decoded `PATH_INFO`."""
    query = _text(environ, "QUERY_STRING")
    uri = _text(environ, "RAW_URI") or _text(environ, "REQUEST_URI")

    if uri == "":
        return RawTarget(_rooted(_text(environ, "PATH_INFO")), query, raw=False)

    path = _without_origin(_without_query(uri))
    script = _raw_text(_text(environ, "SCRIPT_NAME").rstrip("/"))
    stripped = None if script == "" else _stripped_prefix(path, script)

    return RawTarget(_rooted(path if stripped is None else stripped), query, raw=True)


def _text(values: Mapping[str, object], key: str) -> str:
    value = values.get(key)

    return value if isinstance(value, str) else ""


def _raw_text(decoded: str) -> str:
    """A decoded prefix as the raw bytes of a target spell it when sent unescaped."""
    return decoded.encode("utf-8").decode(_BYTES_AS_TEXT)


def _without_query(target: str) -> str:
    return target.split("?", 1)[0]


def _without_origin(path: str) -> str:
    origin = _ORIGIN.match(path)

    return path if origin is None else path[origin.end() :]


def _stripped_prefix(path: str, prefix: str) -> str | None:
    """`path` after `prefix` when the prefix ends at a segment boundary, else None."""
    if path == prefix:
        return ""

    return path[len(prefix) :] if path.startswith(prefix + "/") else None


def _rooted(path: str) -> str:
    return path if path.startswith("/") else "/" + path
