"""Writes every contract reply as status, headers and bytes: a contract error in the api's format, a role's code, the
api's 500, and a declared success body in its format's envelope, serialized by the boundary's own JSON encoding,
never a framework's renderer."""

import json
import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.runtime.contract import INTERNAL_STATUS, UNDECLARED_STATUS_ROLE, ApiContract
from seampact.codegen.runtime.ir_view import IrMap, ir_list, ir_map, ir_string
from seampact.codegen.runtime.templates import render

JSON_MEDIA: Final = "application/json"
CONTENT_TYPE: Final = "content-type"
CACHE_CONTROL: Final = "cache-control"
NO_STORE: Final = "no-store"

_NULL_ABSENT: Final = "null"
_PAYLOAD_SLOT: Final = "payload"
_SECONDS_UNIT: Final = "s"
_MILLISECONDS_PER_SECOND: Final = 1000


@dataclass(frozen=True, slots=True)
class Reply:
    """A reply the boundary writes; header names are lower case."""

    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes

    def header(self, name: str) -> str | None:
        lowered = name.lower()

        return next((value for key, value in self.headers if key == lowered), None)


def json_bytes(value: object) -> bytes:
    """The boundary's JSON: UTF-8, no escaped slashes or non-ASCII, `1.0` kept; NaN and infinities refused. A lone
    surrogate echoed from a request can only sit in a JSON string, so it is written as its `\\uXXXX` escape."""
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    return text.encode("utf-8", errors="backslashreplace")


def error_reply(
    contract: ApiContract, operation_id: str | None, code: str, params: Mapping[str, object] | None = None
) -> Reply:
    """The reply of `code` in the operation's format, or the api's format when no operation matched."""
    format_ = contract.format(operation_id)
    catalogued = contract.catalog_entry(code)
    status = contract.status_of(code)
    slots: dict[str, object] = {"code": code, "status": status, "nature": ir_string(catalogued, "nature")}
    title = ir_string(catalogued, "title")

    if title is not None:
        slots["title"] = title

    if params is not None:
        slots["params"] = params

    error = ir_map(format_, "error")
    body = render(error.get("body"), slots, ir_string(format_, "absent") == _NULL_ABSENT)
    headers = [(CONTENT_TYPE, ir_string(error, "media") or JSON_MEDIA)]

    if catalogued.get("noStore") is True:
        headers.append((CACHE_CONTROL, NO_STORE))

    if operation_id is not None:
        headers.extend(_retry_header(contract.error_declaration(operation_id, code), params))

    return Reply(status, tuple(headers), json_bytes(body.value if body.present else {}))


def role_params(
    contract: ApiContract, operation_id: str, code: str, role: str, slots: Mapping[str, object]
) -> Mapping[str, object] | None:
    """The params a role's template renders from `slots` (`issues`, `limitBytes`), None when the code binds none."""
    template = contract.role_params(operation_id, code, role)

    if template is None:
        return None

    rendered = render(template, slots, write_nulls=False)

    return rendered.value if isinstance(rendered.value, Mapping) else None


def role_reply(contract: ApiContract, operation_id: str | None, role: str, bare_status: int) -> Reply:
    """The role's code in the api's format, or a bare status when the api declares no code for the role."""
    code = contract.role_code(operation_id, role)

    return Reply(bare_status, (), b"") if code is None else error_reply(contract, operation_id, code)


def internal_error_reply(contract: ApiContract, operation_id: str | None) -> Reply:
    """The api's 500; the placement logs the cause and tells the unexpected-error listener."""
    return role_reply(contract, operation_id, UNDECLARED_STATUS_ROLE, INTERNAL_STATUS)


def success_body(format_: IrMap, shape: str, payload: object, status: int, path: str) -> object:
    """The success body in its format's envelope (ADR 0002 section 13): the payload itself under a bare format.

    Raises `LookupError` when the envelope renders nothing, which generation refuses."""
    template = ir_map(ir_map(format_, "success"), shape).get("body")

    if template is None or _is_bare_payload(template):
        return payload

    slots = {_PAYLOAD_SLOT: payload, "status": status, "path": path}
    rendered = render(template, slots, ir_string(format_, "absent") == _NULL_ABSENT)

    if not rendered.present:
        raise LookupError(
            f"seampact: the format's '{shape}' success envelope rendered nothing; regenerate the api, whose "
            "generation refuses an envelope that does not write the payload under named members."
        )

    return rendered.value


def _is_bare_payload(template: object) -> bool:
    return (
        ir_string(template, "kind") == "slot"
        and ir_string(template, "slot") == _PAYLOAD_SLOT
        and not ir_list(template, "path")
    )


def _retry_header(declared: IrMap, params: Mapping[str, object] | None) -> list[tuple[str, str]]:
    """The delay param of a refusal, in integer milliseconds, written in its retry header's unit."""
    retry = ir_map(declared, "retryHeader")
    name = ir_string(retry, "name")
    delay_ms = None if params is None else params.get(ir_string(retry, "param") or "")

    if name is None or isinstance(delay_ms, bool) or not isinstance(delay_ms, int | float):
        return []

    if ir_string(retry, "unit") == _SECONDS_UNIT:
        return [(name.lower(), str(math.ceil(delay_ms / _MILLISECONDS_PER_SECOND)))]

    return [(name.lower(), str(int(delay_ms)))]
