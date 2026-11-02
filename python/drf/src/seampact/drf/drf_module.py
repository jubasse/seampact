"""The `drf` module of an api (ADR 0027 "DRF"): one serializer per operation input and per object schema it reads,
its fields built in `get_fields()` so none shadows a serializer attribute such as `data`, `errors` or `fields`; the
api's base view and exception handler; one function per resource that builds its handlers and checks them against
the resource's protocol; one `APIView` per contract path, with one method per operation of the path, which admits the
request, builds the typed request and replies with the handler's result."""

from collections.abc import Sequence
from typing import Final

from seampact.codegen.names import ApiNames, member_identifier, part_attributes
from seampact.codegen.printer import INDENT, PythonModule, string_literal
from seampact.codegen.refusals import IrPlace, Refusals
from seampact.django.emitters import ContractPath
from seampact.drf.api_layout import ApiLayout, NameClaims, OperationNames, handler_headers, principal_schema
from seampact.drf.expressions import Expression, Keyword, call, lines
from seampact.drf.serializer_fields import RulesMode, SerializerFields
from seampact.ir.model import (
    ArrayTypeUse,
    ContractIR,
    IdentityAccess,
    ObjectSchema,
    Operation,
    OptionalAccess,
    Param,
    RefTypeUse,
    TypeUse,
)
from seampact.ir.naming import IrName, NamingRole, python_identifier

_OPERATIONS: Final = "_operations"
_SCHEMAS: Final = "_schemas"
_SERIALIZER_SUFFIX: Final = "Serializer"


class _Emission:
    def __init__(
        self,
        ir: ContractIR,
        names: ApiNames,
        layout: ApiLayout,
        paths: Sequence[ContractPath],
        rules: RulesMode,
        refusals: Refusals,
    ) -> None:
        self.ir = ir
        self.names = names
        self.layout = layout
        self.paths = paths
        self.refusals = refusals
        self.module = PythonModule(
            f"The DRF placement of api '{ir.api.id}': its serializers, views and exception handler."
        )
        self.fields = SerializerFields(self.module, names, rules, refusals, self._schema_serializer)
        self.runtime = self.module.imported("seampact.drf.runtime", "_drf_runtime")
        self.operations = self.module.imported(".operations", _OPERATIONS)
        self.claims = NameClaims("drf", refusals)
        self.operations_by_id = {operation.id: operation for operation in ir.operations}
        self.request_serializers: set[str] = set()

    def text(self) -> str:
        for schema_id in sorted(_read_schemas(self.ir)):
            self._schema_serializer_block(schema_id)

        for index, operation in enumerate(self.ir.operations):
            operation_names = self.layout.operations.get(operation.id)

            if operation_names is not None:
                self._input_serializers(operation, operation_names, IrPlace(f"/operations/{index}", operation.id))

        self._base_view()

        for owner in self.layout.owners.values():
            self._handlers_builder(owner.key, owner.protocol)

        for contract_path in self.paths:
            self._view(contract_path)

        return self.module.text()

    def _schema_serializer(self, schema_id: str) -> str | None:
        name = self.names.schema_classes.get(schema_id)

        return None if name is None else name + _SERIALIZER_SUFFIX

    def _schema_serializer_block(self, schema_id: str) -> None:
        schema = self.ir.schemas[schema_id]
        at = IrPlace(f"/schemas/{schema_id}")
        members = self.names.members.get(schema_id, {})

        if not isinstance(schema, ObjectSchema):
            return

        fields: list[tuple[str, Expression]] = []

        for index, member in enumerate(schema.properties):
            attribute = members.get(member.name)
            place = at.below("properties", index, "type")

            if attribute is not None:
                field = self.fields.field(member.type, not member.optional, member.nullable, place)
                fields.append((string_literal(attribute), field))

        serializer = self._schema_serializer(schema_id)

        if serializer is not None:
            self._serializer(self.claims.name(serializer, at), f"schema '{schema_id}'", fields)

    def _serializer(self, name: str, subject: str, fields: Sequence[tuple[str, Expression]]) -> None:
        body = [
            f"class {name}({self.runtime}.ContractSerializer):",
            f'{INDENT}"""The fields of {subject}, built in get_fields()."""',
            "",
            f"{INDENT}def get_fields(self) -> {self.runtime}.SerializerFields:",
        ]

        if not fields:
            self.module.add_block([*body, f"{INDENT * 2}return {{}}"])
            return

        entries = [line for key, value in fields for line in lines(value, INDENT * 3, f"{key}: ", ",")]
        self.module.add_block([*body, f"{INDENT * 2}return {{", *entries, f"{INDENT * 2}}}"])

    def _input_serializers(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        parts: list[tuple[str, Expression]] = []

        for part, part_name, params, ir_part in (
            ("path", names.path, operation.params.path, "path"),
            ("query", names.query, operation.params.query, "query"),
            ("headers", names.headers, handler_headers(operation), "header"),
        ):
            if part_name is not None:
                serializer = self.claims.name(part_name + _SERIALIZER_SUFFIX, at)
                self._serializer(
                    serializer,
                    f"the {part} of operation '{operation.id}'",
                    self._params(params, at.below("params", ir_part)),
                )
                parts.append((string_literal(part), call(serializer)))

        if operation.input is not None:
            body = self.fields.field(operation.input.schema, True, False, at.below("input", "schema"))
            parts.append((string_literal("body"), body))

        if parts:
            serializer = self.claims.name(names.request + _SERIALIZER_SUFFIX, at)
            self._serializer(serializer, f"the input of operation '{operation.id}'", parts)
            self.request_serializers.add(operation.id)

    def _params(self, params: Sequence[Param], at: IrPlace) -> list[tuple[str, Expression]]:
        return [
            (string_literal(attribute), self.fields.field(param.type, param.required, False, at.below(index, "type")))
            for index, param, attribute in part_attributes(params, at, self.refusals)
        ]

    def _base_view(self) -> None:
        http = self.module.imported("django.http", "_http")
        abc = self.module.imported("collections.abc", "_abc")
        api = string_literal(self.ir.api.id)
        self.module.add_block(
            [
                "def contract_exception_handler(",
                f"{INDENT}exception: Exception, context: {abc}.Mapping[str, object]",
                f") -> {http}.HttpResponseBase | None:",
                f'{INDENT}"""The exception handler of the contract views, never the app\'s EXCEPTION_HANDLER."""',
                f"{INDENT}return {self.runtime}.contract_exception_reply({api}, exception, context)",
            ]
        )
        base_view = self.claims.name(self.layout.api_class + "View", IrPlace("/api/name"))
        self.module.add_block(
            [
                f"class {base_view}({self.runtime}.ContractView):",
                f'{INDENT}"""The base of the contract views of api \'{self.ir.api.id}\'."""',
                "",
                f"{INDENT}api = {api}",
                "",
                f"{INDENT}def get_exception_handler(self) -> {self.runtime}.ExceptionHandler:",
                f"{INDENT * 2}return contract_exception_handler",
            ]
        )

    def _handlers_builder(self, key: str, protocol: str) -> None:
        http = self.module.imported("django.http", "_http")
        django_runtime = self.module.imported("seampact.django.runtime", "_django_runtime")
        api = string_literal(self.ir.api.id)
        resource = string_literal(key)
        mismatch = call(f"{django_runtime}.HandlersMismatchError", [api, resource, string_literal(protocol), "built"])
        self.module.add_block(
            [
                f"def _{key}_handlers(request: {http}.HttpRequest) -> {self.operations}.{protocol}:",
                f"{INDENT}built = {django_runtime}.built_handlers({api}, {resource}, request)",
                "",
                f"{INDENT}if isinstance(built, {self.operations}.{protocol}):",
                f"{INDENT * 2}return built",
                "",
                *lines(mismatch, INDENT, "raise "),
            ]
        )

    def _view(self, contract_path: ContractPath) -> None:
        first = self.operations_by_id[contract_path.first.operation_id]
        view = view_class(first)
        block = [
            f"class {self.claims.name(view, IrPlace('/operations'))}({self.layout.api_class}View):",
            f'{INDENT}"""The contract path `{contract_path.first.contract_path}`."""',
        ]

        for entry in contract_path.entries:
            operation = self.operations_by_id[entry.operation_id]
            names = self.layout.operations.get(operation.id)

            if names is not None:
                block += ["", *self._view_method(entry.methods[0].lower(), operation, names)]

        self.module.add_block(block)

    def _view_method(self, method: str, operation: Operation, names: OperationNames) -> list[str]:
        http = self.module.imported("django.http", "_http")
        request = self.module.imported("rest_framework.request", "_request")
        owner = names.owner
        arguments: list[Expression] = [Keyword("input", self._input(operation, names))]

        if isinstance(operation.access, IdentityAccess | OptionalAccess):
            reader = "principal" if isinstance(operation.access, IdentityAccess) else "optional_principal"
            principal = self._principal_class(operation.access.identity)
            arguments.append(Keyword("principal", call(f"admission.{reader}", [principal])))

        if names.scopes is not None:
            scopes = [
                Keyword(attribute, call("admission.scope", [string_literal(scope.scope)]))
                for scope in operation.scopes
                if (attribute := member_identifier(scope.scope)) is not None
            ]
            arguments.append(Keyword("scopes", call(f"{self.operations}.{names.scopes}", scopes)))

        reply = call("admission.reply", [call(f"_{owner.key}_handlers(request).{names.method}", ["contract_request"])])

        return [
            f"{INDENT}def {method}(self, request: {request}.Request, **path: str) -> {http}.HttpResponseBase:",
            f"{INDENT * 2}admission = self.admit(request, {string_literal(operation.id)})",
            *lines(call(f"{self.operations}.{names.request}", arguments), INDENT * 2, "contract_request = "),
            "",
            *lines(reply, INDENT * 2, "return "),
        ]

    def _input(self, operation: Operation, names: OperationNames) -> Expression:
        input_type = f"{self.operations}.{names.input}"

        if operation.id not in self.request_serializers:
            return call(input_type)

        return call("admission.input", [names.request + _SERIALIZER_SUFFIX, input_type])

    def _principal_class(self, identity: str) -> str:
        schema = principal_schema(self.ir, identity)
        name = None if schema is None else self.names.schema_classes.get(schema)

        return "object" if name is None else f"{self.module.imported('.schemas', _SCHEMAS)}.{name}"


def view_class(operation: Operation) -> str:
    return python_identifier(IrName((*operation.name.segments, "view"), NamingRole.SCHEMA))


def _read_schemas(ir: ContractIR) -> set[str]:
    """The object schemas an operation input reads, directly or through members."""
    found: set[str] = set()
    pending: list[TypeUse] = [operation.input.schema for operation in ir.operations if operation.input is not None]

    while pending:
        type_use = pending.pop()

        if isinstance(type_use, ArrayTypeUse):
            pending.append(type_use.items)
        elif isinstance(type_use, RefTypeUse) and type_use.schema not in found:
            schema = ir.schemas.get(type_use.schema)

            if isinstance(schema, ObjectSchema):
                found.add(type_use.schema)
                pending += [member.type for member in schema.properties]

    return found


def drf_module(
    ir: ContractIR,
    names: ApiNames,
    layout: ApiLayout,
    paths: Sequence[ContractPath],
    rules: RulesMode,
    refusals: Refusals,
) -> str:
    return _Emission(ir, names, layout, paths, rules, refusals).text()
