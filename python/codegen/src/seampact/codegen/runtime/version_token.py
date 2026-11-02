"""The version check of an operation with `concurrency` (grammar section 6): the client sends the version it last
read in the declared source, which the input step decoded and checked; the handler compares it with the stored one
and answers the `stateConflict` role's code when they differ. The boundary reads the version and builds that
refusal; it never stores a version."""

from collections.abc import Mapping
from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput, role_refusal
from seampact.codegen.runtime.ir_view import ir_map, ir_string

STATE_CONFLICT_ROLE: Final = "stateConflict"


def sent_version(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> object:
    """The version the request carries, None when the client sent none.

    Raises `BoundaryFailureError` for an operation without `concurrency`, or a version source the boundary does not
    read."""
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

    return part.get(name) if isinstance(part, Mapping) else None


def stale_version(contract: ApiContract, operation_id: str) -> ContractRefusal:
    """The refusal a handler raises when the sent version is not the stored one."""
    return role_refusal(contract, operation_id, STATE_CONFLICT_ROLE)
