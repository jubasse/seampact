"""The Python names of one api's FastAPI package (ADR 0026 "Placement"): per operation its request, input parts,
results, typed errors, page and scopes, and its handler method; the endpoints protocol of each resource (an operation
without a resource joins its surface's); one exception per error code and the api's contract exception base; and the
placement's own names. Two classes of one module taking one name are refused as `name.collision`."""

from collections.abc import Mapping
from dataclasses import dataclass

from seampact.codegen.refusals import IrPlace, Refusals
from seampact.ir.model import ContractIR, Operation, Param, ResponseShape
from seampact.ir.naming import IrName, NameSource, NamingRole, python_identifier, segments_of


@dataclass(frozen=True, slots=True)
class OperationNames:
    method: str
    request: str
    input: str
    result: str
    errors: str
    responses: Mapping[int, str]
    page: str | None
    scopes: str | None
    endpoints: str
    owner_attribute: str


@dataclass(frozen=True, slots=True)
class ApiLayout:
    contract_error: str
    handler_factories: str
    bind_function: str
    error_classes: Mapping[str, str]
    error_factories: Mapping[str, str]
    operations: Mapping[str, OperationNames]

    def endpoints_owners(self) -> dict[str, str]:
        """Each endpoints protocol and the attribute of `<Api>HandlerFactories` that builds it, in operation order."""
        return {names.endpoints: names.owner_attribute for names in self.operations.values()}


class _Claims:
    """The names of one module, each with what took it first."""

    def __init__(self, module: str, refusals: Refusals) -> None:
        self._module = module
        self._refusals = refusals
        self._owners: dict[str, str] = {}

    def claim(self, name: str, owner: str, at: IrPlace) -> str:
        previous = self._owners.setdefault(name, owner)

        if previous != owner:
            self._refusals.add(
                "name.collision",
                f"The Python name '{name}' of the {self._module} module would be written for both {previous} and "
                f"{owner}.",
                "Rename one of them in the contract (a schema name, an operation's `operationId` or an error code).",
                at,
            )

        return name


def api_layout(ir: ContractIR, error_codes: list[str], refusals: Refusals) -> ApiLayout:
    root = _Claims("operation types", refusals)
    api_segments = tuple(ir.api.name.segments)
    at_api = IrPlace("/api/name")
    contract_error = root.claim(
        python_identifier(IrName((*api_segments, "contract"), NamingRole.ERROR)), "the api's contract error", at_api
    )
    handler_factories = root.claim(
        python_identifier(IrName((*api_segments, "handler", "factories"), NamingRole.SCHEMA)),
        "the api's handler factories",
        at_api,
    )
    error_classes: dict[str, str] = {}
    error_factories: dict[str, str] = {}

    for code in error_codes:
        at = IrPlace(f"/errors/{code}")
        segments = segments_of(code, NameSource.NAME)

        if not segments:
            refusals.inconsistent("error.code.no-segment", f"The error code '{code}' yields no name segment", at)
            continue

        error_classes[code] = root.claim(
            python_identifier(IrName(tuple(segments), NamingRole.ERROR)), f"the exception of error '{code}'", at
        )
        error_factories[code] = python_identifier(IrName(tuple(segments), NamingRole.MEMBER))

    operations: dict[str, OperationNames] = {}

    for index, operation in enumerate(ir.operations):
        at = IrPlace(f"/operations/{index}", operation.id)
        owner = _endpoints_owner(ir, operation)

        if not owner:
            refusals.inconsistent(
                "endpoints.owner.no-segment",
                f"The operation '{operation.id}' has no resource or surface that yields a name segment",
                at.below("surface"),
            )
            continue

        operations[operation.id] = _operation_names(operation, tuple(owner), root, at)

    return ApiLayout(
        contract_error,
        handler_factories,
        python_identifier(IrName(("bind", *api_segments), NamingRole.OPERATION)),
        error_classes,
        error_factories,
        operations,
    )


def _operation_names(operation: Operation, owner: tuple[str, ...], root: _Claims, at: IrPlace) -> OperationNames:
    segments = tuple(operation.name.segments)
    owned = f"a type of operation '{operation.id}'"

    def in_root(extra: tuple[str, ...], role: NamingRole = NamingRole.SCHEMA) -> str:
        return root.claim(python_identifier(IrName((*segments, *extra), role)), owned, at.below("name"))

    responses = {
        response.status: root.claim(
            python_identifier(IrName(segments, NamingRole.RESPONSE, response.status)),
            f"the {response.status} result of operation '{operation.id}'",
            at.below("name"),
        )
        for response in operation.responses
    }
    paged = operation.paging is not None and any(
        response.shape is ResponseShape.PAGE for response in operation.responses
    )
    return OperationNames(
        method=python_identifier(IrName(segments, NamingRole.OPERATION)),
        request=in_root(("request",)),
        input=in_root((), NamingRole.INPUT),
        result=in_root(("result",)),
        errors=in_root((), NamingRole.ERRORS),
        responses=responses,
        page=in_root(("page",)) if paged else None,
        scopes=in_root(("scopes",)) if operation.scopes else None,
        endpoints=root.claim(
            python_identifier(IrName(owner, NamingRole.ENDPOINTS)),
            f"the endpoints protocol of '{'-'.join(owner)}'",
            at.below("name"),
        ),
        owner_attribute=python_identifier(IrName(owner, NamingRole.MEMBER)),
    )


def handler_headers(operation: Operation) -> list[Param]:
    """The header parameters that reach the handler: the credential and CSRF headers stay the boundary's."""
    return [
        param
        for param in operation.params.header
        if param.derived_from is None or _handler_header_derivation(param.derived_from.derivation)
    ]


def _handler_header_derivation(derivation: str) -> bool:
    return derivation != "identity.authenticate" and not derivation.startswith("csrf.")


def _endpoints_owner(ir: ContractIR, operation: Operation) -> list[str] | None:
    if operation.resource is not None:
        segments = segments_of(operation.resource.type, NameSource.NAME)

        if segments:
            return segments

    surface = ir.api.surfaces.get(operation.surface)

    if surface is not None:
        return list(surface.name.segments)

    return segments_of(operation.surface, NameSource.NAME)
