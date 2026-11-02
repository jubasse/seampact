"""Which operations need the api's idempotency store: those whose idempotency the boundary enforces (ADR 0012 "Target
obligations"), as `begin_idempotency` reads them. The access dependency resolves the store's factory for them only, and
the boot check refuses an api that keeps one without a store."""

from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_string

_DERIVED: Final = "derived"
_BOUNDARY: Final = "boundary"


def enforces_idempotency(contract: ApiContract, operation_id: str) -> bool:
    idempotency = ir_map(contract.operation(operation_id), "idempotency")

    return ir_string(idempotency, "kind") == _DERIVED and ir_string(idempotency, "enforce") == _BOUNDARY
