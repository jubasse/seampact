"""The cache headers of a success the boundary writes (ADR 0012 step 10): `Cache-Control` by caller kind, `Vary`, and
the strong ETag over the body bytes, with its 304 when `If-None-Match` names it. The ETag is the SHA-256 base64url of
the body as every target writes it, so a client's tag stays valid across them."""

import base64
import hashlib
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_maps, ir_string, ir_strings, ir_true
from seampact.codegen.runtime.replies import CACHE_CONTROL, CONTENT_TYPE, NO_STORE, Reply

NOT_MODIFIED: Final = 304
ETAG: Final = "etag"
VARY: Final = "vary"

_WEAK_ETAG_PREFIX: Final = "W/"
_ANY_TAG: Final = "*"
_ANONYMOUS: Final = "anonymous"
_IDENTIFIED: Final = "identified"


def strong_etag(body: bytes) -> str:
    """The quoted SHA-256 base64url of the body bytes, without padding."""
    digest = base64.urlsafe_b64encode(hashlib.sha256(body).digest()).rstrip(b"=").decode("ascii")

    return f'"{digest}"'


def with_cache_headers(
    contract: ApiContract, operation_id: str, reply: Reply, principal: object | None, if_none_match: str | None
) -> Reply:
    """`reply` with the operation's cache headers, or the ETag's 304, with the same headers and no body, when
    `if_none_match` names it; `reply` itself when the operation declares no cache. An authenticated caller (a
    `principal`) always gets the private directives."""
    cache = ir_map(contract.operation(operation_id), "cache")

    if not cache:
        return reply

    added: list[tuple[str, str]] = []
    cache_control = NO_STORE if ir_true(cache, "noStore") else _cache_control(cache, principal)

    if cache_control is not None:
        added.append((CACHE_CONTROL, cache_control))

    vary = ir_strings(cache, "vary")

    if vary:
        added.append((VARY, ", ".join(vary)))

    etag = strong_etag(reply.body) if ir_true(cache, "etag") else None

    if etag is not None:
        added.append((ETAG, etag))

    written = {name for name, _ in added}
    kept = [(name, value) for name, value in reply.headers if name not in written]

    if etag is None or not _if_none_match_holds(if_none_match, etag):
        return Reply(reply.status, (*kept, *added), reply.body)

    without_content_type = [(name, value) for name, value in kept if name != CONTENT_TYPE]

    return Reply(NOT_MODIFIED, (*without_content_type, *added), b"")


def _cache_control(cache: object, principal: object | None) -> str | None:
    caller = _ANONYMOUS if principal is None else _IDENTIFIED

    return next(
        (
            ir_string(entry, "cacheControl")
            for entry in ir_maps(cache, "perCallerKind")
            if entry.get("caller") == caller
        ),
        None,
    )


def _if_none_match_holds(if_none_match: str | None, etag: str) -> bool:
    if if_none_match is None:
        return False

    tags = (tag.strip() for tag in if_none_match.split(","))

    return any(tag in (_ANY_TAG, etag, _WEAK_ETAG_PREFIX + etag) for tag in tags)
