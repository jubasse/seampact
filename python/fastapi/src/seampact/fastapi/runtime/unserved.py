"""The operation features this release of `seampact-fastapi` does not serve yet (ADR 0026 "Delivery": paging,
idempotency, cache headers, field rights, version tokens, deadline budgets, relays and signed requests come with the
next releases). The boot check refuses an operation that uses one, by name, and its access dependency answers the
api's 500 when the boot check is off, so no feature is dropped in silence."""

from typing import Final

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.ir_view import ir_map, ir_string

FEATURE_UNAVAILABLE: Final = "fastapi.feature.unavailable"

_EXEMPT: Final = "exempt"
# Each operation member the next releases serve, and the name a problem gives it.
_FEATURES: Final = (
    ("idempotency", "idempotency"),
    ("paging", "paging"),
    ("cache", "cache headers"),
    ("fieldRights", "field rights"),
    ("concurrency", "version tokens"),
    ("budgetMs", "deadline budgets"),
    ("deadlineHeader", "deadline headers"),
    ("relays", "relays"),
)


def unserved_features(contract: ApiContract, operation_id: str) -> list[str]:
    """The features of the operation this release does not serve, empty when it serves them all."""
    operation = contract.operation(operation_id)
    features: list[str] = []

    for member, name in _FEATURES:
        value = operation.get(member)

        if not value or (member == "idempotency" and ir_string(value, "kind") == _EXEMPT):
            continue

        features.append(name)

    identity = ir_string(ir_map(operation, "access"), "identity")

    if identity is not None and ir_string(contract.declaration("identities", identity), "signed") is not None:
        features.append("signed requests")

    return features


def unserved_problem(api: str, operation_id: str, features: list[str]) -> str:
    return (
        f"{FEATURE_UNAVAILABLE}: operation '{operation_id}' uses {', '.join(features)}, which this seampact-fastapi "
        f"release does not serve yet; leave it out with the `operations` filter of the '{api}' entry until a release "
        "serves it"
    )
