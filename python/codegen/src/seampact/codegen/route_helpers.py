"""The route helpers of one api (ADR 0023 and ADR 0026 "Routes"): `<Api>RouteNames`, one constant per operation
holding the route name the placement registers, and `<Api>Urls`, one static method per operation building the
contract's path from one typed argument per path parameter, in path order, each value encoded as one segment by the
runtime. The artefact switch `routeHelpers: false` leaves both out."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.printer import INDENT, PythonModule, fits, string_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.routes import RouteEntry, placeholders
from seampact.ir.model import ContractIR, EnumTypeUse, Operation, ScalarType, ScalarTypeUse, TypeUse
from seampact.ir.naming import IrName, NamingRole, python_identifier

_SCALAR_ANNOTATIONS: Final = {
    ScalarType.STRING: "str",
    ScalarType.INTEGER: "int",
    ScalarType.NUMBER: "float",
    ScalarType.BOOLEAN: "bool",
}
_FORMAT_ANNOTATIONS: Final = {
    "uuid": ("uuid", "_uuid", "_uuid.UUID"),
    "date-time": ("datetime", "_datetime", "_datetime.datetime"),
}


_NAMES_REGISTERED: Final = "The route name of each operation, as the target registers it."


def route_helpers_module(
    ir: ContractIR, routes: Sequence[RouteEntry], refusals: Refusals, names_registered: str = _NAMES_REGISTERED
) -> str:
    """`names_registered` is the route names' docstring: a target that registers them under a namespace says so."""
    api_class = python_identifier(IrName(tuple(ir.api.name.segments), NamingRole.SCHEMA))
    module = PythonModule(f"The route names and contract paths of api '{ir.api.id}'.")
    typing = module.imported("typing", "_typing")
    wire = module.imported("seampact.codegen.runtime.wire_values", "_wire_values")
    operations = {operation.id: (index, operation) for index, operation in enumerate(ir.operations)}
    names = [
        f"class {api_class}RouteNames:",
        f'{INDENT}"""{names_registered}"""',
        "",
    ]
    urls = [f"class {api_class}Urls:", f'{INDENT}"""The path of each operation, each value encoded as one segment."""']

    for entry in sorted(routes, key=lambda route: operations[route.operation_id][0]):
        index, operation = operations[entry.operation_id]
        constant = python_identifier(IrName(tuple(operation.name.segments), NamingRole.ENUM_MEMBER))
        names += [f"{INDENT}{constant}: {typing}.Final = {string_literal(entry.name)}"]
        urls += [
            "",
            *_url_method(module, wire, entry, operation, IrPlace(f"/operations/{index}", operation.id), refusals),
        ]

    module.add_block(names)
    module.add_block(urls)

    return module.text()


def _url_method(
    module: PythonModule, wire: str, entry: RouteEntry, operation: Operation, at: IrPlace, refusals: Refusals
) -> list[str]:
    method = python_identifier(IrName(tuple(operation.name.segments), NamingRole.OPERATION))
    types = {param.name: param.type for param in operation.params.path}
    parameters = [
        f"{segment.attribute}: {_annotation(module, types[segment.text], at, refusals)}"
        for segment in placeholders(entry)
    ]
    doc = f'{INDENT * 2}"""The path of operation \'{operation.id}\', `{entry.contract_path}`."""'
    head = [f"{INDENT}@staticmethod", f"{INDENT}def {method}({', '.join(parameters)}) -> str:", doc]
    path = string_literal(entry.contract_path)

    if not parameters:
        return [*head, f"{INDENT * 2}return {path}"]

    values = "{" + ", ".join(f"{string_literal(s.text)}: {s.attribute}" for s in placeholders(entry)) + "}"
    single = f"{INDENT * 2}return {wire}.contract_path({path}, {values})"

    if fits(single):
        return [*head, single]

    return [
        *head,
        f"{INDENT * 2}return {wire}.contract_path(",
        f"{INDENT * 3}{path},",
        f"{INDENT * 3}{values},",
        f"{INDENT * 2})",
    ]


def _annotation(module: PythonModule, type_use: TypeUse, at: IrPlace, refusals: Refusals) -> str:
    # An enum member is a `StrEnum` member, so a `str` takes it.
    if isinstance(type_use, EnumTypeUse):
        return "str"

    if isinstance(type_use, ScalarTypeUse) and isinstance(type_use.type, ScalarType):
        formatted = _FORMAT_ANNOTATIONS.get(type_use.format or "")

        if formatted is not None:
            module.imported(formatted[0], formatted[1])
            return formatted[2]

        return _SCALAR_ANNOTATIONS.get(type_use.type, "str")

    refusals.waiting(
        "path.param.type", f"A path parameter of kind '{type_use.kind}'", at.below("params", "path"), Delivery.CONSUMER
    )
    return "str"
