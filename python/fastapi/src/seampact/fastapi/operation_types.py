"""The `operations` module of an api's package (ADR 0026 "Placement"): the api's contract exception base and one
exception per error code; the credentials class of each identity, one `str | None` per scheme, hidden from `repr`; per
operation its scopes, its request (the typed input and who is calling), one frozen class per declared success, its
page, its typed errors and its result union; and the endpoints protocol of each resource, whose methods a plain `def`
or an `async def` satisfies."""

from typing import Final

from seampact.codegen.credentials_classes import credentials_class
from seampact.codegen.names import ApiNames, member_identifier
from seampact.codegen.printer import INDENT, PythonModule, bracketed, string_literal
from seampact.codegen.redacted_members import redacted_dataclass_reprs, redacted_marker_block
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.fastapi.input_schemas import INPUT_PARTS, input_schema_id
from seampact.fastapi.layout import ApiLayout, OperationNames
from seampact.fastapi.runtime.page_facts import PAGE_FACTS
from seampact.fastapi.source_lines import with_local_imports
from seampact.ir.model import (
    ContractIR,
    CredentialIdentity,
    HandlerResultMember,
    IdentityAccess,
    Operation,
    OptionalAccess,
    RefTypeUse,
    ResponseShape,
    SchemaPrincipal,
    SignedIdentity,
    TypeUse,
)

_FROZEN: Final = "@_dataclasses.dataclass(frozen=True, slots=True)"
_FROZEN_KEYWORDS: Final = "@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)"
# The fields of an `<Op>Errors` class: an error factory's name never starts with `_` and a letter.
_ERRORS_CODE_FIELD: Final = "_code"
_ERRORS_PARAMS_FIELD: Final = "_params"
# The members of an `<Op>Request` and the body member of an `<Op>Input`.
_INPUT: Final = "input"
_PRINCIPAL: Final = "principal"
_SCOPES: Final = "scopes"
_BODY: Final = "body"
_PAGE_ITEMS: Final = "items"
_ENDPOINTS_DOC: Final = "The handlers of these operations: each returns a declared success or error, or raises one."
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
        self.names = names
        self.layout = layout
        self.refusals = refusals
        self.module = PythonModule(f"The operation types of api '{ir.api.id}'.")
        self.blocks: list[list[str]] = []
        self._redacted_declared = False

    def text(self) -> str:
        self.module.imported("dataclasses", "_dataclasses")
        self.module.imported("typing", "_typing")
        self.module.imported("pydantic", "_pydantic")
        self._errors()
        self._credentials()

        for index, operation in enumerate(self.ir.operations):
            names = self.layout.operations.get(operation.id)

            if names is not None:
                self._operation(operation, names, IrPlace(f"/operations/{index}", operation.id))

        self._endpoints()

        first, *rest = self.blocks
        self.module.add_block(with_local_imports(["schemas"], [], first))

        for block in rest:
            self.module.add_block(block)

        return self.module.text()

    def _errors(self) -> None:
        base = self.layout.contract_error
        api = self.ir.api.id
        self.blocks.append(
            [
                f"class {base}(Exception):",
                f'{INDENT}"""A declared error of api {api!r}, raised by a handler."""',
                "",
                f"{INDENT}CODE: _typing.ClassVar[str]",
                f"{INDENT}STATUS: _typing.ClassVar[int]",
                "",
                f"{INDENT}def __init__(self, params: _pydantic.BaseModel | None = None) -> None:",
                f'{INDENT * 2}super().__init__(f"The declared error {{self.CODE!r}} of api {api!r}.")',
                f"{INDENT * 2}self.params = params",
            ]
        )

        for code, class_name in self.layout.error_classes.items():
            error = self.ir.errors.get(code)

            if error is None:
                self.refusals.inconsistent(
                    "error.undeclared", f"The error '{code}' is not declared", IrPlace("/errors")
                )
                continue

            lines = [
                f"class {class_name}({base}):",
                f'{INDENT}"""The error {code!r}."""',
                "",
                f"{INDENT}CODE = {string_literal(code)}",
                f"{INDENT}STATUS = {error.http.status}",
            ]
            params = self._params_class(code)

            if params is not None:
                lines += [
                    "",
                    f"{INDENT}def __init__(self, params: {params}) -> None:",
                    f"{INDENT * 2}super().__init__(params)",
                ]

            self.blocks.append(lines)

    def _params_class(self, code: str) -> str | None:
        error = self.ir.errors.get(code)

        if error is None or error.params is None:
            return None

        name = self.names.schema_classes.get(error.params)

        if name is None:
            self.refusals.inconsistent(
                "error.params.missing",
                f"The params schema '{error.params}' of error '{code}' is not an object",
                IrPlace(f"/errors/{code}/params"),
            )
            return None

        return f"_schemas.{name}"

    def _operation(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        if names.scopes is not None:
            self._scopes(operation, names.scopes)

        self._input(operation, names, at)
        self._request(operation, names, at)

        if names.page is not None:
            self._page(operation, names.page, at)

        for index, response in enumerate(operation.responses):
            self._response(operation, names, response.status, index, at)

        self._typed_errors(operation, names)
        alternatives = [*names.responses.values(), names.errors]
        self.blocks.append([f"type {names.result} = {' | '.join(alternatives)}"])

    def _credentials(self) -> None:
        for identity, credentials in self.layout.credentials.items():
            self.blocks.append(credentials_class(_FROZEN_KEYWORDS, identity, credentials))

    def _scopes(self, operation: Operation, class_name: str) -> None:
        hooks = self.module.imported("seampact.hooks", "_hooks")
        lines = [
            _FROZEN_KEYWORDS,
            f"class {class_name}:",
            f'{INDENT}"""The scopes operation {operation.id!r} resolved, one per scope."""',
            "",
        ]
        lines += [f"{INDENT}{member_identifier(scope.scope)}: {hooks}.ResolvedScope" for scope in operation.scopes]
        self.blocks.append(lines)

    def _input(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        lines = [
            _FROZEN_KEYWORDS,
            f"class {names.input}:",
            f'{INDENT}"""The input of operation {operation.id!r}, as its handler reads it."""',
        ]
        annotations = {
            part: f"_schemas.{self.names.schema_classes[input_schema_id(operation.id, part)]}"
            for part, _ in INPUT_PARTS
            if input_schema_id(operation.id, part) in self.names.schema_classes
        }

        if operation.input is not None:
            body_at = at.below("input", "schema")
            annotations[_BODY] = self._type_of(
                operation.input.schema, body_at, "A request body that is not an object schema"
            )

        if not annotations:
            self.blocks.append(lines)
            return

        lines += ["", *(f"{INDENT}{part}: {annotation}" for part, annotation in annotations.items())]

        if _BODY in annotations and self._is_signed(operation):
            lines += self._redacted_reprs(names.input, list(annotations), {_BODY})

        self.blocks.append(lines)

    def _request(self, operation: Operation, names: OperationNames, at: IrPlace) -> None:
        lines = [
            _FROZEN_KEYWORDS,
            f"class {names.request}:",
            f'{INDENT}"""What the handler of operation {operation.id!r} reads: its input and who is calling."""',
            "",
            f"{INDENT}{_INPUT}: {names.input}",
        ]
        principal = self._principal(operation, at)

        if principal is not None:
            lines.append(f"{INDENT}{_PRINCIPAL}: {principal}")

        if names.scopes is not None:
            lines.append(f"{INDENT}{_SCOPES}: {names.scopes}")

        attributes = [_INPUT, *([_PRINCIPAL] if principal is not None else []), *([_SCOPES] if names.scopes else [])]

        if len(attributes) > 1:
            lines += self._redacted_reprs(names.request, attributes, {_PRINCIPAL, _SCOPES})

        self.blocks.append(lines)

    def _is_signed(self, operation: Operation) -> bool:
        access = operation.access

        return isinstance(access, IdentityAccess | OptionalAccess) and isinstance(
            self.ir.identities.get(access.identity), SignedIdentity
        )

    def _redacted_reprs(self, class_name: str, attributes: list[str], redacted: set[str]) -> list[str]:
        """Who is calling and a signed body are printed `[redacted]` (ADR 0023 "Redaction")."""
        if not self._redacted_declared:
            self._redacted_declared = True
            self.blocks.append(redacted_marker_block())

        abc = self.module.imported("collections.abc", "_abc")

        return redacted_dataclass_reprs(class_name, attributes, redacted, abc)

    def _principal(self, operation: Operation, at: IrPlace) -> str | None:
        access = operation.access

        if not isinstance(access, IdentityAccess | OptionalAccess):
            return None

        identity = self.ir.identities.get(access.identity)
        principal = identity.principal if isinstance(identity, CredentialIdentity | SignedIdentity) else None

        if not isinstance(principal, SchemaPrincipal):
            self.refusals.waiting(
                "identity.principal", "A principal that is not one schema", at.below("access"), Delivery.CONSUMER
            )
            return "object"

        name = self.names.schema_classes.get(principal.schema)

        if name is None:
            self.refusals.inconsistent("principal.schema.missing", f"No object schema '{principal.schema}'", at)
            return "object"

        return f"_schemas.{name}" if isinstance(access, IdentityAccess) else f"_schemas.{name} | None"

    def _response(self, operation: Operation, names: OperationNames, status: int, index: int, at: IrPlace) -> None:
        response = operation.responses[index]
        lines = [
            _FROZEN,
            f"class {names.responses[status]}:",
            f'{INDENT}"""The {status} reply of operation {operation.id!r}."""',
        ]

        if response.body is None:
            if response.shape is not ResponseShape.EMPTY:
                self.refusals.inconsistent("response.body.missing", "A response with a shape has no body", at)

            self.blocks.append(lines)
            return

        body = self._type_of(response.body, at.below("responses", index, "body"))

        if response.shape is ResponseShape.TABLE:
            body = f"dict[str, {body}]"
        elif response.shape is ResponseShape.LIST:
            body = f"list[{body}]"
        elif response.shape is ResponseShape.PAGE and names.page is not None:
            body = names.page

        self.blocks.append([*lines, "", f"{INDENT}body: {body}"])

    def _type_of(
        self, type_use: TypeUse, at: IrPlace, description: str = "A response body that is not an object schema"
    ) -> str:
        name = self.names.schema_classes.get(type_use.schema) if isinstance(type_use, RefTypeUse) else None

        if name is None:
            self.refusals.waiting("body.kind", description, at, Delivery.CONSUMER)
            return "object"

        return f"_schemas.{name}"

    def _page(self, operation: Operation, class_name: str, at: IrPlace) -> None:
        page = next(response for response in operation.responses if response.shape is ResponseShape.PAGE)
        item = "object" if page.body is None else self._type_of(page.body, at.below("responses"))
        lines = [
            _FROZEN_KEYWORDS,
            f"class {class_name}:",
            f'{INDENT}"""The page of operation {operation.id!r}: its items and the facts its paging style reads."""',
            "",
            f"{INDENT}{_PAGE_ITEMS}: list[{item}]",
        ]
        style = self.ir.pagings.get(operation.paging.style or "") if operation.paging is not None else None
        facts = {_PAGE_ITEMS: _PAGE_ITEMS}

        if style is None:
            self.refusals.inconsistent(
                "paging.style.undeclared", "The paging style is not declared", at.below("paging")
            )
        else:
            for member in style.handler_result:
                lines += self._page_fact(member, facts, at.below("paging", "style"))

        table = ", ".join(f"{string_literal(attribute)}: {string_literal(fact)}" for attribute, fact in facts.items())
        lines += ["", f"{INDENT}{PAGE_FACTS}: _typing.ClassVar[dict[str, str]] = {{{table}}}"]
        self.blocks.append(lines)

    def _page_fact(self, member: object, facts: dict[str, str], at: IrPlace) -> list[str]:
        """The attribute of one page fact, entered in the page's fact table; a fact without an attribute name of its
        own is refused by name."""
        fact_type = _PAGE_FACT_TYPES.get(member) if isinstance(member, HandlerResultMember) else None

        if fact_type is None:
            self.refusals.waiting("paging.handlerResult", f"The page fact '{member}'", at, Delivery.AFTER_V1)
            return []

        attribute = member_identifier(str(member))

        if attribute is None or attribute in facts:
            self.refusals.inconsistent(
                "paging.handlerResult.attribute",
                f"The page fact '{member}' has no attribute name of its own on the page class",
                at,
            )
            return []

        facts[attribute] = str(member)

        return [f"{INDENT}{attribute}: {fact_type} | None = None"]

    def _typed_errors(self, operation: Operation, names: OperationNames) -> None:
        lines = [
            _FROZEN_KEYWORDS,
            f"class {names.errors}:",
            f'{INDENT}"""A declared error of operation {operation.id!r}, returned by its handler instead of raised."""',
            "",
            f"{INDENT}{_ERRORS_CODE_FIELD}: str",
            f"{INDENT}{_ERRORS_PARAMS_FIELD}: _pydantic.BaseModel | None",
        ]
        listed: set[str] = set()

        for error in operation.errors:
            factory = self.layout.error_factories.get(error.code)

            if factory is None or error.code in listed:
                continue

            listed.add(error.code)
            params = self._params_class(error.code)
            arguments = ["cls"] if params is None else ["cls", f"params: {params}"]
            lines += [
                "",
                f"{INDENT}@classmethod",
                *bracketed(INDENT, f"def {factory}", arguments, " -> _typing.Self:"),
                *bracketed(
                    INDENT * 2,
                    "return cls",
                    [
                        f"{_ERRORS_CODE_FIELD}={string_literal(error.code)}",
                        f"{_ERRORS_PARAMS_FIELD}={'None' if params is None else 'params'}",
                    ],
                    "",
                ),
            ]

        self.blocks.append(lines)

    def _endpoints(self) -> None:
        protocols: dict[str, list[str]] = {}

        for operation in self.ir.operations:
            names = self.layout.operations.get(operation.id)

            if names is None:
                continue

            abc = self.module.imported("collections.abc", "_abc")
            lines = protocols.setdefault(
                names.endpoints,
                [
                    f"class {names.endpoints}(_typing.Protocol):",
                    f'{INDENT}"""{_ENDPOINTS_DOC}"""',
                    "",
                ],
            )
            awaitable = f"{names.result} | {abc}.Awaitable[{names.result}]"
            lines += bracketed(
                INDENT, f"def {names.method}", ["self", f"request: {names.request}", "/"], f" -> {awaitable}: ..."
            )

        self.blocks += protocols.values()


def operation_types_module(ir: ContractIR, names: ApiNames, layout: ApiLayout, refusals: Refusals) -> str:
    """The `operations` module of the api's package; `ir` holds the input schemas, `names` their classes."""
    return _Emission(ir, names, layout, refusals).text()
