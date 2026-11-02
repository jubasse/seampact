"""The `operations` module of an api on the DRF target (ADR 0026 "Placement", ADR 0027 "Types and validation"): per
operation the frozen dataclasses its handler reads (the input and its path, query, header and body parts, the scopes,
who is calling) and returns (one class per declared success status, the page of a paged list, the typed errors), the
result union; per error code one exception under the api's contract base; per resource the handler protocol."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.credentials_classes import credentials_class
from seampact.codegen.names import ApiNames, member_identifier, part_attributes
from seampact.codegen.printer import INDENT, PythonModule, string_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.drf.api_layout import ApiLayout, OperationNames, handler_headers, principal_schema
from seampact.drf.dataclass_schemas import DATACLASS_DECORATOR, dataclass_head, is_sensitive_use, redacted_fields
from seampact.drf.python_types import PythonTypes
from seampact.ir.hydration import OMITTED
from seampact.ir.model import (
    ContractIR,
    HandlerResultMember,
    IdentityAccess,
    Operation,
    OptionalAccess,
    Param,
    PublicAccess,
    ResponseShape,
    ResponseShapeUnknown,
    TypeUse,
)

SCHEMAS_MODULE: Final = ".schemas"
SCHEMAS_ALIAS: Final = "_schemas"

_PRINCIPAL: Final = "principal"
_PAGE_FACT_TYPES: Final = {
    HandlerResultMember.NEXT_CURSOR: "str",
    HandlerResultMember.PREVIOUS_CURSOR: "str",
    HandlerResultMember.NEXT_SINCE: "str",
    HandlerResultMember.TOTAL: "int",
    HandlerResultMember.MORE: "bool",
}


class _Emission:
    def __init__(self, ir: ContractIR, names: ApiNames, layout: ApiLayout, refusals: Refusals) -> None:
        self.ir = ir
        self.layout = layout
        self.refusals = refusals
        self.module = PythonModule(f"The operation types, exceptions and handler protocols of api '{ir.api.id}'.")
        self.types = PythonTypes(ir, names, refusals, schemas=f"{SCHEMAS_ALIAS}.")
        self.names = names

    def _credentials(self) -> None:
        decorator = f"@{self.module.imported('dataclasses', '_dataclasses')}.{DATACLASS_DECORATOR}"

        for identity, credentials in self.layout.credentials.items():
            self.module.add_block(credentials_class(decorator, identity, credentials))

    def text(self) -> str:
        self._exceptions()

        for index, operation in enumerate(self.ir.operations):
            operation_names = self.layout.operations.get(operation.id)

            if operation_names is not None:
                self._operation(operation, operation_names, IrPlace(f"/operations/{index}", operation.id))

        self._credentials()
        self._protocols()

        return self.module.text()

    def dataclass(self, name: str, doc: str, members: Sequence[str], redacted: Sequence[str] = ()) -> None:
        """A frozen dataclass; its repr hides the `redacted` attributes."""
        hidden = redacted_fields(self.module, redacted)
        body = [f'{INDENT}"""{doc}"""', *([""] if members else []), *hidden, *members]
        self.module.add_block([*dataclass_head(self.module, name, redacted), *body])

    def schemas(self) -> str:
        return self.module.imported(SCHEMAS_MODULE, SCHEMAS_ALIAS)

    def _exceptions(self) -> None:
        base = f"{self.layout.api_class}ContractError"
        typing = self.module.imported("typing", "_typing")
        self.module.add_block(
            [
                f"class {base}(Exception):",
                f'{INDENT}"""A declared error of api \'{self.ir.api.id}\', raised by a handler or a hook instead of '
                'returned."""',
                "",
                f"{INDENT}code: {typing}.ClassVar[str]",
                "",
                f"{INDENT}def __init__(self, params: object | None = None) -> None:",
                f"{INDENT * 2}super().__init__(self.code)",
                f"{INDENT * 2}self.params = params",
            ]
        )

        for code, class_name in self.layout.error_classes.items():
            params = self._params_class(code)
            lines = [
                f"class {class_name}({base}):",
                f'{INDENT}"""The error \'{code}\'."""',
                "",
                f"{INDENT}code = {string_literal(code)}",
            ]

            if params is not None:
                lines += [
                    "",
                    f"{INDENT}def __init__(self, params: {params}) -> None:",
                    f"{INDENT * 2}super().__init__(params)",
                ]

            self.module.add_block(lines)

    def _params_class(self, code: str) -> str | None:
        params = self.ir.errors[code].params

        if params is None:
            return None

        name = self.names.schema_classes.get(params)

        if name is None:
            self.refusals.inconsistent(
                "error.params.missing", f"No object schema '{params}'", IrPlace(f"/errors/{code}")
            )
            return None

        return f"{self.schemas()}.{name}"

    def _operation(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        input_members = [
            *self._part(names.path, "path", operation.params.path, operation, at.below("params", "path")),
            *self._part(names.query, "query", operation.params.query, operation, at.below("params", "query")),
            *self._part(names.headers, "headers", handler_headers(operation), operation, at.below("params", "header")),
        ]

        if operation.input is not None:
            body = self.types.annotation(self.module, operation.input.schema, at.below("input", "schema"))
            input_members.append(f"{INDENT}body: {body}")

        self.dataclass(names.input, f"The input of operation '{operation.id}', as its handler reads it.", input_members)
        request_members = [f"{INDENT}input: {names.input}", *self._caller(operation, names, at)]
        # Who is calling is redacted (ADR 0026 "Redaction").
        caller = [_PRINCIPAL] if isinstance(operation.access, IdentityAccess | OptionalAccess) else []
        self.dataclass(
            names.request,
            f"What the handler of operation '{operation.id}' is called with.",
            request_members,
            caller,
        )
        self._results(operation, names, at)

    def _part(
        self, name: str | None, part: str, params: Sequence[Param], operation: Operation, at: IrPlace
    ) -> list[str]:
        if name is None:
            return []

        members = []
        redacted = []

        for index, param, attribute in part_attributes(params, at, self.refusals):
            if param.default is not OMITTED:
                self.refusals.waiting(
                    "param.default", f"The parameter '{param.name}' with a default", at.below(index), Delivery.CONSUMER
                )

            suffix = "" if param.required else " | None"
            annotation = self.types.annotation(self.module, param.type, at.below(index, "type"), suffix)
            members.append(f"{INDENT}{attribute}: {annotation}{'' if param.required else ' = None'}")

            if is_sensitive_use(param.type):
                redacted.append(attribute)

        self.dataclass(name, f"The {part} parameters of operation '{operation.id}'.", members, redacted)

        return [f"{INDENT}{part}: {name}"]

    def _caller(self, operation: Operation, names: OperationNames, at: IrPlace) -> list[str]:
        """Who is calling: the principal on a route with an identity, the scopes on a scoped route."""
        members = []
        access = operation.access

        if isinstance(access, IdentityAccess | OptionalAccess):
            principal = self._principal(access.identity, at.below("access"))
            optional = " | None" if isinstance(access, OptionalAccess) else ""
            members.append(f"{INDENT}{_PRINCIPAL}: {principal}{optional}")
        elif not isinstance(access, PublicAccess):
            self.refusals.unknown_value(access.kind, at.below("access", "kind"))

        if names.scopes is not None:
            hooks = self.module.imported("seampact.hooks", "_hooks")
            scopes = []

            for index, scope in enumerate(operation.scopes):
                attribute = member_identifier(scope.scope)

                if attribute is None:
                    self.refusals.inconsistent(
                        "scope.no-segment", f"The scope '{scope.scope}' has no name segment", at.below("scopes", index)
                    )
                    continue

                scopes.append(f"{INDENT}{attribute}: {hooks}.ResolvedScope")

            self.dataclass(names.scopes, f"The scopes operation '{operation.id}' runs in, outermost first.", scopes)
            members.append(f"{INDENT}scopes: {names.scopes}")

        return members

    def _principal(self, identity: str, at: IrPlace) -> str:
        schema = principal_schema(self.ir, identity)
        name = None if schema is None else self.names.schema_classes.get(schema)

        if name is None:
            self.refusals.waiting(
                "principal.variants", f"The principal of identity '{identity}', not one schema", at, Delivery.CONSUMER
            )
            return "object"

        return f"{self.schemas()}.{name}"

    def _results(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        typing = self.module.imported("typing", "_typing")

        for index, response in enumerate(operation.responses):
            self.dataclass(
                names.responses[response.status],
                f"The {response.status} reply of operation '{operation.id}'.",
                [
                    f"{INDENT}status: {typing}.ClassVar[int] = {response.status}",
                    *self._response_body(operation, names, response.shape, response.body, at.below("responses", index)),
                ],
            )

        self._errors(operation, names)
        alternatives = " | ".join(
            [*(names.responses[response.status] for response in operation.responses), names.errors]
        )
        self.module.add_block([f"type {names.result} = {alternatives}"])

    def _response_body(
        self,
        operation: Operation,
        names: OperationNames,
        shape: ResponseShape | ResponseShapeUnknown,
        body: TypeUse | None,
        at: IrPlace,
    ) -> list[str]:
        if not isinstance(shape, ResponseShape):
            self.refusals.unknown_value(shape.raw, at.below("shape"))
            return []

        if shape is ResponseShape.EMPTY:
            return []

        if body is None:
            self.refusals.inconsistent("response.body.missing", f"A '{shape.value}' response has no body", at)
            return []

        item = self.types.annotation(self.module, body, at.below("body"))
        bodies = {
            ResponseShape.ITEM: item,
            ResponseShape.LIST: f"list[{item}]",
            ResponseShape.TABLE: f"dict[str, {item}]",
        }

        if shape in bodies:
            return [f"{INDENT}body: {bodies[shape]}"]

        if shape is ResponseShape.PAGE and names.page is not None:
            self._page(operation, names.page, item, at)
            return [f"{INDENT}body: {names.page}"]

        self.refusals.waiting(f"response.{shape.value}", f"A '{shape.value}' response", at, Delivery.CONSUMER)
        return []

    def _page(self, operation: Operation, name: str, item: str, at: IrPlace) -> None:
        """The page a paged list's handler returns: its items and the facts its paging style reads, each optional."""
        members = [f"{INDENT}items: list[{item}]"]
        style = self.ir.pagings.get(operation.paging.style or "") if operation.paging is not None else None

        if style is None:
            self.refusals.inconsistent(
                "paging.style.undeclared", "The paging style is not declared", at.below("paging")
            )
            return

        for fact in style.handler_result:
            fact_type = _PAGE_FACT_TYPES.get(fact) if isinstance(fact, HandlerResultMember) else None
            attribute = member_identifier(fact.value if isinstance(fact, HandlerResultMember) else fact.raw)

            if fact_type is None or attribute is None:
                self.refusals.waiting(
                    "paging.handlerResult", f"The page fact '{fact}'", at.below("paging"), Delivery.AFTER_V1
                )
                continue

            members.append(f"{INDENT}{attribute}: {fact_type} | None = None")

        self.dataclass(name, f"The page operation '{operation.id}' answers: its items and its paging facts.", members)

    def _errors(self, operation: Operation, names: OperationNames) -> None:
        typing = self.module.imported("typing", "_typing")
        lines = [
            f"@{self.module.imported('dataclasses', '_dataclasses')}.{DATACLASS_DECORATOR}",
            f"class {names.errors}:",
            f'{INDENT}"""A declared error of operation \'{operation.id}\', returned instead of raised."""',
            "",
            f"{INDENT}code: str",
            f"{INDENT}params: object | None = None",
        ]
        listed: set[str] = set()

        for error in operation.errors:
            factory = self.layout.error_factories.get(error.code)

            if factory is None or error.code in listed:
                continue

            listed.add(error.code)
            params = self._params_class(error.code)
            code = string_literal(error.code)
            lines += ["", f"{INDENT}@classmethod"]

            if params is None:
                lines += [
                    f"{INDENT}def {factory}(cls) -> {typing}.Self:",
                    f"{INDENT * 2}return cls(code={code})",
                ]
            else:
                lines += [
                    f"{INDENT}def {factory}(cls, params: {params}) -> {typing}.Self:",
                    f"{INDENT * 2}return cls(code={code}, params=params)",
                ]

        self.module.add_block(lines)

    def _protocols(self) -> None:
        typing = self.module.imported("typing", "_typing")

        for owner in self.layout.owners.values():
            lines = [
                f"@{typing}.runtime_checkable",
                f"class {owner.protocol}({typing}.Protocol):",
                f'{INDENT}"""The handlers of \'{owner.key}\'; a factory builds them per request."""',
            ]

            for operation in self.ir.operations:
                names = self.layout.operations.get(operation.id)

                if names is not None and names.owner is owner:
                    lines += ["", f"{INDENT}def {names.method}(self, request: {names.request}) -> {names.result}: ..."]

            self.module.add_block(lines)


def operations_module(ir: ContractIR, names: ApiNames, layout: ApiLayout, refusals: Refusals) -> str:
    return _Emission(ir, names, layout, refusals).text()
