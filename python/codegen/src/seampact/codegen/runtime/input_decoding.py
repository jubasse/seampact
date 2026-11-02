"""Step 1's decoding: the path parameters percent-decoded from the raw path, the query from the raw query string, the
declared headers, and the body (bounded read, media type, `json` with objects and arrays kept apart); each placement
hands the decoded parts to its own step 6."""

import json
import re
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.runtime.body_reader import (
    PAYLOAD_TOO_LARGE_ROLE,
    SCHEMA_INVALID_ROLE,
    UNSUPPORTED_MEDIA_TYPE_ROLE,
    read_body,
)
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.ir_view import ir_int, ir_map, ir_maps, ir_string, ir_true
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.codegen.runtime.replies import role_params
from seampact.codegen.runtime.wire_values import decoded_segment, list_items, path_value, query_value, raw_query
from seampact.codegen.runtime.wire_values import scalar as scalar_value

_CONTENT_LENGTH: Final = "content-length"
_CONTENT_TYPE: Final = "content-type"
_CONTENT_ENCODING: Final = "content-encoding"
_TRANSFER_ENCODING: Final = "transfer-encoding"
_MAX_JSON_DEPTH: Final = 512
_LONE_SURROGATE: Final = re.compile("[\ud800-\udfff]")


@dataclass(frozen=True, slots=True)
class IncomingRequest:
    """What a placement reads of a contract request: header names in lower case, the first value of each."""

    method: str
    target: RawTarget
    headers: Mapping[str, str]
    body: AsyncIterator[bytes]


@dataclass(frozen=True, slots=True, repr=False)
class DecodedInput:
    """The params by name, decoded by the IR's wire form, and the body tree (None when the request carries none);
    `raw_body` holds the bytes as received on a signed route only. `repr` shows no value."""

    path: dict[str, object]
    query: dict[str, object]
    headers: dict[str, object]
    body: object
    raw_body: bytes | None

    def __repr__(self) -> str:
        return "DecodedInput([redacted])"


@dataclass(frozen=True, slots=True)
class Issue:
    """One refused input value: where (`path`, `query`, `header`, `body`), the JSON pointer and the contract rule."""

    in_: str
    pointer: str
    rule: str

    def as_slot(self) -> dict[str, str]:
        return {"in": self.in_, "pointer": self.pointer, "rule": self.rule}


async def decode_input(
    contract: ApiContract, operation_id: str, raw_parameters: Mapping[str, str], request: IncomingRequest
) -> DecodedInput:
    """Raises `ContractRefusal` with the operation's code for a refused body or path value."""
    operation = contract.operation(operation_id)
    params = ir_map(operation, "params")
    path: dict[str, object] = {}

    for param in ir_maps(params, "path"):
        name = ir_string(param, "name") or ""
        raw = raw_parameters.get(name, "")

        if decoded_segment(raw) is None:
            raise schema_invalid(contract, operation_id, [Issue("path", f"/{name}", "type")])

        path[name] = path_value(raw, ir_map(param, "type"))

    headers: dict[str, object] = {}

    for param in ir_maps(params, "header"):
        name = ir_string(param, "name") or ""
        value = request.headers.get(name.lower())

        if value is not None:
            headers[name] = scalar_value(value, ir_map(param, "type"))

    query = _query(ir_maps(params, "query"), request.target.query)
    input_ = ir_map(operation, "input")
    body: object = None
    raw_body: bytes | None = None

    if input_ and _carries_body(request.headers):
        data = await _body_bytes(contract, operation_id, input_, request)
        raw_body = data if ir_true(input_, "rawBody") else None
        body = None if data == b"" else _json_tree(contract, operation_id, data)

    return DecodedInput(path, query, headers, body, raw_body)


def schema_invalid(contract: ApiContract, operation_id: str, issues: list[Issue]) -> ContractRefusal:
    """The operation's `schemaInvalid` refusal with its issues."""
    return role_refusal(contract, operation_id, SCHEMA_INVALID_ROLE, {"issues": [issue.as_slot() for issue in issues]})


def role_refusal(
    contract: ApiContract, operation_id: str, role: str, slots: Mapping[str, object] | None = None
) -> ContractRefusal:
    """Raises `BoundaryFailureError` when the operation declares no code for `role`, which the compiler derives."""
    code = contract.role_code(operation_id, role)

    if code is None:
        raise BoundaryFailureError(
            f"seampact: operation '{operation_id}' has no code for the role '{role}'; regenerate the api."
        )

    return ContractRefusal(contract.api, code, role_params(contract, operation_id, code, role, slots or {}))


def _query(declared: list[Mapping[str, object]], raw: str) -> dict[str, object]:
    by_name = {ir_string(param, "name") or "": param for param in declared}
    query: dict[str, object] = {}

    for name, raw_values in raw_query(raw).items():
        param = by_name.get(name)
        values = list_items(raw_values, None if param is None else param.get("wire"))

        if param is None:
            query[name] = values[0] if len(values) == 1 else values
        else:
            query[name] = query_value(values, ir_map(param, "type"))

    return query


async def _body_bytes(
    contract: ApiContract, operation_id: str, input_: Mapping[str, object], request: IncomingRequest
) -> bytes:
    # The bounded read comes first, so an oversized body answers 413 whatever its media type (ADR 0012).
    limit_bytes = ir_int(input_, "bodyLimitBytes")

    if limit_bytes is None:
        raise BoundaryFailureError(f"seampact: operation '{operation_id}' has no body limit; regenerate the api.")

    read = await read_body(
        request.body, request.headers.get(_CONTENT_LENGTH), request.headers.get(_CONTENT_ENCODING), limit_bytes
    )

    if read.refused_role == PAYLOAD_TOO_LARGE_ROLE:
        raise role_refusal(contract, operation_id, PAYLOAD_TOO_LARGE_ROLE, {"limitBytes": limit_bytes})

    media = (request.headers.get(_CONTENT_TYPE) or "").split(";", 1)[0].strip().lower()

    if read.refused_role == UNSUPPORTED_MEDIA_TYPE_ROLE or (read.data != b"" and media != ir_string(input_, "media")):
        raise role_refusal(contract, operation_id, UNSUPPORTED_MEDIA_TYPE_ROLE)

    if read.refused_role is not None:
        raise schema_invalid(contract, operation_id, [Issue("body", "", "type")])

    return read.data


def _json_tree(contract: ApiContract, operation_id: str, data: bytes) -> object:
    try:
        tree: object = json.loads(data.decode("utf-8"), parse_constant=_refuse_constant)
    except (ValueError, RecursionError):
        raise schema_invalid(contract, operation_id, [Issue("body", "", "type")]) from None

    if _depth(tree) > _MAX_JSON_DEPTH or _holds_lone_surrogate(tree):
        raise schema_invalid(contract, operation_id, [Issue("body", "", "type")])

    return tree


def _refuse_constant(name: str) -> object:
    """`NaN` and the infinities are not JSON."""
    raise ValueError(f"{name} is not JSON")


def _holds_lone_surrogate(tree: object) -> bool:
    """A string value with a lone surrogate, which is not Unicode text; a key keeps it, for the unknown-key report."""
    pending = [tree]

    while pending:
        item = pending.pop()

        if isinstance(item, str) and _LONE_SURROGATE.search(item) is not None:
            return True

        if isinstance(item, dict):
            pending.extend(item.values())
        elif isinstance(item, list):
            pending.extend(item)

    return False


def _depth(tree: object) -> int:
    depth = 0
    level = [tree]

    while level:
        containers = [item for item in level if isinstance(item, dict | list)]

        if not containers:
            return depth

        depth += 1
        level = [child for item in containers for child in (item.values() if isinstance(item, dict) else item)]

    return depth


def _carries_body(headers: Mapping[str, str]) -> bool:
    length = headers.get(_CONTENT_LENGTH)

    return (length is not None and length != "0") or _TRANSFER_ENCODING in headers
