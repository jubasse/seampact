"""The members of an authenticated principal the boundary reads (ADR 0023 "Keys"): only those the principal schema
declares, by wire name, as the wire writes them. The idempotency partition and a principal bucket key come from them,
so two callers never share a key because their principal has no readable state."""

from collections.abc import Mapping

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import ir_map, ir_string
from seampact.codegen.runtime.wire_codec import WireCodec


def principal_members(
    contract: ApiContract, operation_id: str, principal: object | None
) -> Mapping[str, object] | None:
    """Each declared member of the operation's principal by wire name, None for an anonymous caller.

    Raises `BoundaryFailureError` for a principal that is not the generated principal type, or one whose schema
    declares no member, since its callers could not be told apart."""
    if principal is None:
        return None

    access = ir_map(contract.operation(operation_id), "access")
    identity = ir_string(access, "identity") or ""
    schema_id = ir_string(ir_map(contract.declaration("identities", identity), "principal"), "schema") or ""

    if not contract.members.get(schema_id):
        raise BoundaryFailureError(
            f"seampact: the principal of identity '{identity}' declares no member, so its callers cannot be told "
            "apart; declare one in its schema and regenerate the api."
        )

    members = WireCodec(contract).to_wire({"kind": "ref", "schema": schema_id}, principal)

    if not isinstance(members, Mapping):
        raise BoundaryFailureError(
            f"seampact: the authenticate hook of identity '{identity}' returned a {type(principal).__qualname__}; "
            f"return the generated principal type of '{schema_id}'."
        )

    return members
