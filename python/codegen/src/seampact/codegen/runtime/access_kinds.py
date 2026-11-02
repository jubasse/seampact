"""The access kind of an operation, which a framework's own security layer is configured by (ADR 0027 "DRF" and
"Ninja"): `public`, `optional` or `identity` from its access, or `signed` when a signature verifies its identity."""

from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_string

SIGNED_KIND: Final = "signed"
# The kinds of the PHP targets' native security layers: a signed identity never shares the classes of a signed-in
# caller's routes.
ACCESS_KINDS: Final = ("public", "optional", "identity", SIGNED_KIND)


def access_kind(contract: ApiContract, operation_id: str) -> str:
    """`public`, `optional` or `identity` from the operation's access, or `signed` when a signature verifies its
    identity."""
    access = ir_map(contract.operation(operation_id), "access")
    identity = ir_string(access, "identity")

    if identity is not None and ir_string(contract.declaration("identities", identity), "signed") is not None:
        return SIGNED_KIND

    return ir_string(access, "kind") or ""
