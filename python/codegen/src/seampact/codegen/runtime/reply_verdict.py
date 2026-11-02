"""Step 10, the outgoing response check (ADR 0016), on a reply the placement has in hand: a reply the boundary wrote
passes; a success it did not write is a violation; a declared error status from another writer is held up to
`MAX_CHECKED_ERROR_BODY_BYTES` and must carry one of the operation's codes for that status in the api's format; any
other status is a violation. The verdict strips an ETag the boundary did not set and applies the `responses` mode."""

import hashlib
import json
import zlib
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_list, ir_map, ir_maps, ir_string
from seampact.codegen.runtime.replies import CONTENT_TYPE, JSON_MEDIA, Reply, internal_error_reply

MAX_CHECKED_ERROR_BODY_BYTES: Final = 65536

_ERROR_FLOOR: Final = 400
_ETAG: Final = "etag"
_CONTENT_ENCODING: Final = "content-encoding"
_HEAD: Final = "HEAD"
# `wbits` of zlib: a gzip header, and a zlib header for HTTP's `deflate`.
_GZIP_WINDOW: Final = 16 + zlib.MAX_WBITS
_DEFLATE_WINDOW: Final = zlib.MAX_WBITS


class ResponsesMode(StrEnum):
    STRICT = "strict"
    WARN = "warn"


class FrameworkEtagMode(StrEnum):
    STRIP = "strip"
    KEEP = "keep"


@dataclass(frozen=True, slots=True)
class OutgoingReply:
    """A reply as it leaves the app: lower-case header names; `body` None when it was not held (a stream, or past
    `MAX_CHECKED_ERROR_BODY_BYTES`)."""

    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes | None

    def header(self, name: str) -> str | None:
        return next((value for key, value in self.headers if key == name), None)


@dataclass(frozen=True, slots=True)
class AuthoredReply:
    status: int
    body_digest: bytes
    etag: str | None


@dataclass(slots=True)
class AuthoredReplies:
    """The replies the boundary wrote for one request, kept in the request's state."""

    replies: list[AuthoredReply] = field(default_factory=list)

    def author(self, reply: Reply) -> Reply:
        self.replies.append(AuthoredReply(reply.status, _digest(reply.body), reply.header(_ETAG)))

        return reply

    def find(self, reply: OutgoingReply, method: str) -> AuthoredReply | None:
        """The written reply with this status and body; a HEAD reply whose body the server emptied matches too."""
        if reply.body is None:
            return None

        digest = _digest(reply.body)

        for written in self.replies:
            body_kept = written.body_digest == digest or (reply.body == b"" and method.upper() == _HEAD)

            if written.status == reply.status and body_kept:
                return written

        return None


@dataclass(frozen=True, slots=True)
class Verdict:
    """The reply to send; `violation` names what the check found, `replaced` tells the api's 500 took its place."""

    reply: OutgoingReply
    violation: str | None
    replaced: bool


def verdict(
    contract: ApiContract,
    operation_id: str,
    reply: OutgoingReply,
    *,
    authored: AuthoredReplies,
    method: str,
    admitted: bool,
    responses: ResponsesMode,
    framework_etag: FrameworkEtagMode,
) -> Verdict:
    """Strips a foreign ETag, then judges the reply: under `strict` a violation is replaced by the api's 500, under
    `warn` it goes out as written. The placement logs a violation and tells the unexpected-error listener."""
    written = authored.find(reply, method)
    checked = _without_foreign_etag(reply, written, framework_etag)
    violation = None if written is not None else foreign_reply_violation(contract, operation_id, checked, admitted)

    if violation is None or responses is ResponsesMode.WARN:
        return Verdict(checked, violation, replaced=False)

    internal = internal_error_reply(contract, operation_id)

    return Verdict(OutgoingReply(internal.status, internal.headers, internal.body), violation, replaced=True)


def foreign_reply_violation(
    contract: ApiContract, operation_id: str, reply: OutgoingReply, admitted: bool
) -> str | None:
    """The violation of a reply the boundary did not write, None when it passes."""
    status = reply.status

    if status < _ERROR_FLOOR:
        return f"a {status} reply the boundary did not write"

    codes = contract.declared_codes(operation_id, status)

    if not codes:
        return f"the undeclared status {status}"

    # Once admitted, only the boundary or a contract exception's rendering writes the reply.
    if admitted:
        return f"a {status} reply written after the boundary's access step admitted the request"

    return _error_body_violation(contract, operation_id, reply, codes)


def _error_body_violation(
    contract: ApiContract, operation_id: str, reply: OutgoingReply, codes: Sequence[str]
) -> str | None:
    status = reply.status
    error_format = ir_map(contract.format(operation_id), "error")
    error_media = (ir_string(error_format, "media") or JSON_MEDIA).lower()
    media = (reply.header(CONTENT_TYPE) or "").split(";", 1)[0].strip().lower()

    if reply.body is None:
        return f"a {status} error body that cannot be checked"

    if media != error_media:
        return f"a {status} error body that is not {error_media}"

    coding = (reply.header(_CONTENT_ENCODING) or "").strip().lower()
    content = _decoded(reply.body, coding)

    if content is None:
        return f"a {status} error body in the content coding '{coding}', which the boundary cannot decode"

    try:
        body = json.loads(content)
    except ValueError:
        return f"a {status} error body that is not JSON"

    code_member = _code_member(error_format)
    code = body.get(code_member) if isinstance(body, dict) and code_member is not None else None

    return None if isinstance(code, str) and code in codes else f"a {status} error body without a declared code"


def _code_member(error_format: object) -> str | None:
    """The top-level member of the format's error body that the `code` slot fills."""
    for member in ir_maps(ir_map(error_format, "body"), "members"):
        value = ir_map(member, "value")

        if ir_string(value, "kind") == "slot" and ir_string(value, "slot") == "code" and not ir_list(value, "path"):
            return ir_string(ir_map(member, "name"), "text")

    return None


def _decoded(body: bytes, coding: str) -> bytes | None:
    """The body without its content coding; None for a coding the standard library cannot decode (`br`) or a
    corrupt body."""
    if coding in ("", "identity"):
        return body

    window = {"gzip": _GZIP_WINDOW, "x-gzip": _GZIP_WINDOW, "deflate": _DEFLATE_WINDOW}.get(coding)

    if window is None:
        return None

    try:
        return zlib.decompress(body, window)
    except zlib.error:
        return None


def _without_foreign_etag(
    reply: OutgoingReply, written: AuthoredReply | None, mode: FrameworkEtagMode
) -> OutgoingReply:
    etag = reply.header(_ETAG)
    own_etag = None if written is None else written.etag

    if etag is None or etag == own_etag or mode is FrameworkEtagMode.KEEP:
        return reply

    headers = tuple((name, value) for name, value in reply.headers if name != _ETAG)

    return OutgoingReply(reply.status, headers, reply.body)


def _digest(body: bytes) -> bytes:
    return hashlib.sha256(body).digest()
