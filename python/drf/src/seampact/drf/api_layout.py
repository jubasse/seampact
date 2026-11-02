"""The Python names of one api's operation types on the DRF target: per operation its request, input and input
parts, scopes, responses, page, errors and result; per resource (or surface, for an operation without one) its
handler protocol and the settings key of its handler factory; per error code its exception and its factory method.
Every name of the `operations` module is claimed once; a name taken twice is refused, naming both."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Final

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import ContractIR, Operation, Param
from seampact.ir.naming import IrName, NameSource, NamingRole, python_identifier, segments_of

_BOUNDARY_HEADER_DERIVATIONS: Final = frozenset({"identity.authenticate"})
_BOUNDARY_HEADER_DERIVATION_PREFIXES: Final = ("csrf.",)


@dataclass(frozen=True, slots=True)
class OperationNames:
    request: str
    input: str
    path: str | None
    query: str | None
    headers: str | None
    scopes: str | None
    result: str
    errors: str
    page: str | None
    method: str
    owner: str
    responses: Mapping[int, str]


@dataclass(frozen=True, slots=True)
class HandlerOwner:
    """A handler protocol (`TasksEndpoints`) and the settings key of its factory (`tasks`)."""

    protocol: str
    key: str


@dataclass(slots=True)
class ApiLayout:
    api_class: str
    operations: dict[str, OperationNames] = field(default_factory=dict)
    owners: dict[tuple[str, ...], HandlerOwner] = field(default_factory=dict)
    error_classes: dict[str, str] = field(default_factory=dict)
    error_factories: dict[str, str] = field(default_factory=dict)


def api_layout(ir: ContractIR, refusals: Refusals) -> ApiLayout:
    layout = ApiLayout(python_identifier(IrName(tuple(ir.api.name.segments), NamingRole.SCHEMA)))
    claimed: dict[str, IrPlace] = {}
    claim = _Claims(claimed, refusals)

    claim.name(f"{layout.api_class}ContractError", IrPlace("/api/name"))

    for code in sorted(ir.errors):
        at = IrPlace(f"/errors/{code}")
        segments = segments_of(code, NameSource.NAME, None, None)

        if not segments:
            refusals.inconsistent("error.code.no-segment", f"The error code '{code}' has no name segment", at)
            continue

        layout.error_classes[code] = claim.name(python_identifier(IrName(tuple(segments), NamingRole.ERROR)), at)
        layout.error_factories[code] = python_identifier(IrName(tuple(segments), NamingRole.MEMBER))

    for index, operation in enumerate(ir.operations):
        at = IrPlace(f"/operations/{index}", operation.id)
        owner = _owner(ir, operation)

        if owner is None:
            refusals.inconsistent(
                "endpoints.owner.no-segment",
                f"The operation '{operation.id}' has no resource or surface that gives a name segment",
                at.below("surface"),
            )
            continue

        if owner not in layout.owners:
            protocol = claim.name(python_identifier(IrName(owner, NamingRole.ENDPOINTS)), at.below("name"))
            layout.owners[owner] = HandlerOwner(protocol, python_identifier(IrName(owner, NamingRole.MEMBER)))

        layout.operations[operation.id] = _operation_names(operation, layout.owners[owner], claim, at.below("name"))

    return layout


def _operation_names(operation: Operation, owner: HandlerOwner, claim: "_Claims", at: IrPlace) -> OperationNames:
    segments = tuple(operation.name.segments)

    def type_name(role: NamingRole, *words: str, status: int | None = None) -> str:
        return claim.name(python_identifier(IrName((*segments, *words), role, status)), at)

    def part_name(present: bool, role: NamingRole, *words: str) -> str | None:
        return type_name(role, *words) if present else None

    return OperationNames(
        request=type_name(NamingRole.SCHEMA, "request"),
        input=type_name(NamingRole.INPUT),
        path=part_name(bool(operation.params.path), NamingRole.PATH),
        query=part_name(bool(operation.params.query), NamingRole.QUERY),
        headers=part_name(bool(handler_headers(operation)), NamingRole.HEADERS),
        scopes=part_name(bool(operation.scopes), NamingRole.SCHEMA, "scopes"),
        result=type_name(NamingRole.SCHEMA, "result"),
        errors=type_name(NamingRole.ERRORS),
        page=part_name(operation.paging is not None, NamingRole.SCHEMA, "page"),
        method=python_identifier(IrName(segments, NamingRole.OPERATION)),
        owner=owner.protocol,
        responses={
            response.status: type_name(NamingRole.RESPONSE, status=response.status) for response in operation.responses
        },
    )


def handler_headers(operation: Operation) -> list[Param]:
    """The header parameters the handler reads: the credential and CSRF headers stay the boundary's."""
    return [
        param
        for param in operation.params.header
        if not _boundary_header(param.derived_from.derivation if param.derived_from is not None else "")
    ]


def _boundary_header(derivation: str) -> bool:
    return derivation in _BOUNDARY_HEADER_DERIVATIONS or derivation.startswith(_BOUNDARY_HEADER_DERIVATION_PREFIXES)


def _owner(ir: ContractIR, operation: Operation) -> tuple[str, ...] | None:
    """A resource's operations share one protocol; one without a resource joins its surface's."""
    if operation.resource is not None:
        segments = segments_of(operation.resource.type, NameSource.NAME, None, None)

        if segments:
            return tuple(segments)

    surface = ir.api.surfaces.get(operation.surface)
    segments = list(surface.name.segments) if surface is not None else segments_of(operation.surface, NameSource.NAME)

    return tuple(segments) if segments else None


class _Claims:
    def __init__(self, claimed: dict[str, IrPlace], refusals: Refusals) -> None:
        self._claimed = claimed
        self._refusals = refusals

    def name(self, name: str, at: IrPlace) -> str:
        earlier = self._claimed.setdefault(name, at)

        if earlier is not at:
            self._refusals.add(
                "name.collision",
                f"The names at {earlier.pointer} and at {at.pointer} both give the Python class '{name}' in the "
                "operations module.",
                "Rename one of them in the contract, or give one a `codeName`.",
                at,
            )

        return name
