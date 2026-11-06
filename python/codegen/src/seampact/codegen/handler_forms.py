"""The forms the generated boundary validates but does not enforce, which the handler owes: each is named with a
warning at generation, as on the Node servers (ADR 0016 "Left to the handler"), never dropped silently. An identity's
request `headers` are validated as declared headers only, so the handler reads them. An identity header the server
would write on a response (a versionToken, or a header declared `in: response`) has no value a handler can write, a
reply carrying only a body, so it is refused by name at its declaration rather than dropped."""

from dataclasses import dataclass
from typing import Final

from seampact.codegen.refusals import Delivery, IrPlace, Refusals, place_in_entry
from seampact.ir.config.problem import ConfigProblem
from seampact.ir.model import (
    ContractIR,
    CredentialIdentity,
    HeaderDecl,
    HeaderSemantic,
    HeaderSide,
    HeaderUseFor,
    IdentityAccess,
    IdentityHeaderUse,
    Operation,
    OptionalAccess,
    SignedIdentity,
)

IDENTITY_HEADERS_HANDLER: Final = "identity.headers.handler"
IDENTITY_RESPONSE_HEADER: Final = "identity.response.header"
_IDENTITY_HEADERS_FIX: Final = "Read the identity headers the boundary validated in the handler."


@dataclass(frozen=True, slots=True)
class _ResponseHeader:
    header_id: str
    name: str


@dataclass(frozen=True, slots=True)
class _IdentityHeaders:
    identity_id: str
    request_side_uses: int
    response_side: list[_ResponseHeader]


def handler_warnings(ir: ContractIR, entry_id: str, api: str) -> list[ConfigProblem]:
    """One warning per operation whose identity declares request headers."""
    warnings: list[ConfigProblem] = []

    for index, operation in enumerate(ir.operations):
        headers = _identity_headers(ir, operation)

        if headers is None or headers.request_side_uses == 0:
            continue

        identity_id = headers.identity_id

        place = IrPlace(f"/operations/{index}", operation.id).below("access")
        warnings.append(
            ConfigProblem(
                IDENTITY_HEADERS_HANDLER,
                f"The headers of the identity '{identity_id}' in operation '{operation.id}' at {place.pointer} is not "
                "enforced by the generated boundary.",
                _IDENTITY_HEADERS_FIX,
                place_in_entry(entry_id, place, api),
            )
        )

    return warnings


def refuse_identity_response_headers(ir: ContractIR, refusals: Refusals) -> None:
    """Refuses by name each identity header an operation would write on its responses, at the header's declaration."""
    for operation in ir.operations:
        headers = _identity_headers(ir, operation)

        if headers is None:
            continue

        for header in headers.response_side:
            refusals.waiting(
                IDENTITY_RESPONSE_HEADER,
                f"The response header '{header.name}' of the identity '{headers.identity_id}'",
                IrPlace(f"/headers/{header.header_id}", operation.id),
                Delivery.AFTER_V1,
            )


def _identity_headers(ir: ContractIR, operation: Operation) -> _IdentityHeaders | None:
    access = operation.access

    if not isinstance(access, IdentityAccess | OptionalAccess):
        return None

    identity = ir.identities.get(access.identity)

    if not isinstance(identity, CredentialIdentity | SignedIdentity) or not identity.headers:
        return None

    request_side_uses = 0
    response_side: list[_ResponseHeader] = []

    for use in identity.headers:
        declaration = ir.headers.get(use.header)

        if declaration is None or not _is_response_side(declaration):
            request_side_uses += 1
            continue

        name = _response_header_name(declaration, use, operation)

        if name is not None:
            response_side.append(_ResponseHeader(use.header, name))

    return _IdentityHeaders(access.identity, request_side_uses, response_side)


def _is_response_side(declaration: HeaderDecl) -> bool:
    return declaration.semantic == HeaderSemantic.VERSION_TOKEN or declaration.in_ == HeaderSide.RESPONSE


def _response_header_name(declaration: HeaderDecl, use: IdentityHeaderUse, operation: Operation) -> str | None:
    """A versionToken answers on every success of the identity; another semantic only where its `for` applies. An
    unknown `for` is taken to apply, so nothing is dropped unnamed."""
    if declaration.semantic == HeaderSemantic.VERSION_TOKEN:
        return declaration.response

    if use.for_ == HeaderUseFor.READS and not operation.safe:
        return None

    if use.for_ == HeaderUseFor.WRITES and operation.safe:
        return None

    return declaration.name
