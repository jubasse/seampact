"""The version check of an operation with `concurrency` (grammar section 6): the client sends the version it last
read in the declared source, which the input step decoded and checked; the handler compares it with the stored one
and answers the stale role's code when they differ: `stateConflict` (409) for a body or query version,
`preconditionFailed` (412) for a header one, whose absence is `preconditionRequired` (428). `If-Match` carries the
version as an entity tag, strong or weak (a compressing server or proxy weakens the tag it read, and the version is
the same), which the boundary unquotes. The boundary reads the version and builds those
refusals; it never stores a version."""

import dataclasses
from collections.abc import Mapping
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput, role_refusal
from seampact.codegen.runtime.ir_view import ir_map, ir_string

STATE_CONFLICT_ROLE: Final = "stateConflict"
PRECONDITION_FAILED_ROLE: Final = "preconditionFailed"
PRECONDITION_REQUIRED_ROLE: Final = "preconditionRequired"
_HEADER_SOURCE: Final = "header"
_IF_MATCH: Final = "if-match"
_TAG_QUOTE: Final = '"'
_WEAK_TAG_PREFIX: Final = "W/"
_ANY_TAG: Final = "*"


def sent_version(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> object:
    """The version the request carries, None when the client sent none in a body or query source.

    A placement calls it before the input check of the version parameter, so a missing header is never
    `schemaInvalid`. Raises `ContractRefusal` with the `preconditionRequired` role for a header version the client did
    not send or sent empty, `If-Match: *` included (it carries no version), and with the `preconditionFailed` role
    for an `If-Match` value that is not one entity tag (it can match no version). Raises `BoundaryFailureError` for an
    operation without `concurrency`, or a version source the boundary does not read."""
    source = ir_map(ir_map(contract.operation(operation_id), "concurrency"), "version")
    where = ir_string(source, "in")
    name = ir_string(source, "name") or ""
    parts: Mapping[str, object] = {
        "path": decoded.path,
        "query": decoded.query,
        "header": decoded.headers,
        "body": decoded.body,
    }
    part = parts.get(where or "")

    if where is None or where not in parts:
        raise BoundaryFailureError(
            f"seampact: operation '{operation_id}' reads its version from {where!r}, which is not a request part the "
            "boundary reads; regenerate the api."
        )

    version = part.get(name) if isinstance(part, Mapping) else None

    if where != _HEADER_SOURCE:
        return version

    if version is None or (isinstance(version, str) and version.strip() == ""):
        raise role_refusal(contract, operation_id, PRECONDITION_REQUIRED_ROLE)

    if name.lower() != _IF_MATCH:
        return version

    if isinstance(version, str) and version.strip() == _ANY_TAG:
        raise role_refusal(contract, operation_id, PRECONDITION_REQUIRED_ROLE)

    return _tag_value(contract, operation_id, version)


def with_sent_version(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> DecodedInput:
    """The decoded input after the version check, a header version unquoted (`If-Match: "7"` or `W/"7"` reads `7`),
    as the handler compares it; the input itself for an operation without `concurrency`. Raises as `sent_version`."""
    concurrency = ir_map(contract.operation(operation_id), "concurrency")

    if not concurrency:
        return decoded

    version = sent_version(contract, operation_id, decoded)
    source = ir_map(concurrency, "version")

    if ir_string(source, "in") != _HEADER_SOURCE:
        return decoded

    headers = {**decoded.headers, ir_string(source, "name") or "": version}

    return dataclasses.replace(decoded, headers=headers)


def stale_version(contract: ApiContract, operation_id: str) -> ContractRefusal:
    """The refusal a handler raises when the sent version is not the stored one."""
    source = ir_map(ir_map(contract.operation(operation_id), "concurrency"), "version")
    role = PRECONDITION_FAILED_ROLE if ir_string(source, "in") == _HEADER_SOURCE else STATE_CONFLICT_ROLE

    return role_refusal(contract, operation_id, role)


def _tag_value(contract: ApiContract, operation_id: str, tag: object) -> str:
    """The version inside `"7"` or `W/"7"`; a list or bare text names no version, so it is stale."""
    if not isinstance(tag, str):
        raise role_refusal(contract, operation_id, PRECONDITION_FAILED_ROLE)

    value = tag.strip().removeprefix(_WEAK_TAG_PREFIX)
    quoted = len(value) >= 2 and value.startswith(_TAG_QUOTE) and value.endswith(_TAG_QUOTE)

    if not quoted or _TAG_QUOTE in value[1:-1]:
        raise role_refusal(contract, operation_id, PRECONDITION_FAILED_ROLE)

    return value[1:-1]
