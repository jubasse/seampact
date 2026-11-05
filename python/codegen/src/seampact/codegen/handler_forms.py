"""The forms the generated boundary validates but does not enforce, which the handler owes: each is named with a
warning at generation, as on the Node servers (ADR 0016 "Left to the handler"), never dropped silently. An identity's
`headers` (the rights-version header among them) are validated as declared headers only, so the handler compares the
rights version and answers the stale-rights error."""

from typing import Final

from seampact.codegen.refusals import IrPlace, place_in_entry
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.model import (
    ContractIR,
    CredentialIdentity,
    IdentityAccess,
    Operation,
    OptionalAccess,
    SignedIdentity,
)

IDENTITY_HEADERS_HANDLER: Final = "identity.headers.handler"
_IDENTITY_HEADERS_FIX: Final = "Read the identity headers the boundary validated in the handler."


def handler_warnings(ir: ContractIR, entry_id: str) -> list[ConfigProblem]:
    """One warning per operation whose identity declares headers."""
    warnings: list[ConfigProblem] = []

    for index, operation in enumerate(ir.operations):
        identity_id = _identity_with_headers(ir, operation)

        if identity_id is None:
            continue

        place = IrPlace(f"/operations/{index}", operation.id).below("access")
        warnings.append(
            ConfigProblem(
                IDENTITY_HEADERS_HANDLER,
                f"The headers of the identity '{identity_id}' in operation '{operation.id}' at {place.pointer} is not "
                "enforced by the generated boundary.",
                _IDENTITY_HEADERS_FIX,
                place_in_entry(entry_id, place),
            )
        )

    return warnings


def _identity_with_headers(ir: ContractIR, operation: Operation) -> str | None:
    access = operation.access

    if not isinstance(access, IdentityAccess | OptionalAccess):
        return None

    identity = ir.identities.get(access.identity)

    if isinstance(identity, CredentialIdentity | SignedIdentity) and identity.headers:
        return access.identity

    return None
