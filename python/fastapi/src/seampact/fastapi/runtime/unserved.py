"""The operation features this release of `seampact-fastapi` does not serve yet (ADR 0026 "Delivery": relays come with
fastapi-4). The boot check refuses an operation that uses one, by name, and its access dependency answers the api's 500
when the boot check is off, so no feature is dropped in silence."""

from typing import Final

from seampact.codegen.runtime.contract import ApiContract

FEATURE_UNAVAILABLE: Final = "fastapi.feature.unavailable"

# Each operation member a next release serves, and the name a problem gives it.
_FEATURES: Final = (("relays", "relays"),)


def unserved_features(contract: ApiContract, operation_id: str) -> list[str]:
    """The features of the operation this release does not serve, empty when it serves them all."""
    operation = contract.operation(operation_id)

    return [name for member, name in _FEATURES if operation.get(member)]


def unserved_problem(api: str, operation_id: str, features: list[str]) -> str:
    return (
        f"{FEATURE_UNAVAILABLE}: operation '{operation_id}' uses {', '.join(features)}, which this seampact-fastapi "
        f"release does not serve yet; leave it out with the `operations` filter of the '{api}' entry until a release "
        "serves it"
    )
