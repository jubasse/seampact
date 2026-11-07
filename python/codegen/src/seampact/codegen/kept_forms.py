"""The contract forms no Python target serves, read from the operations the entry keeps and refused by name for every
target alike (ADR 0026 "Refused by name or waiting"): the IR forms absent from the reference contract wait for a
consumer after 1.0, as on the PHP targets. The forms of the reference contract a target brings in a later release,
and the forms its own runtime cannot serve, stay with the target; the shared Pydantic emitter refuses the schema forms
it does not write (unions, maps, member defaults, unknown formats)."""

import re
from collections.abc import Sequence
from typing import Final

from seampact.codegen.handler_forms import refuse_identity_response_headers
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.codegen.response_header_forms import refuse_response_header_forms
from seampact.ir.hydration import OMITTED, JsonValue
from seampact.ir.model import (
    AccessUnknown,
    ArrayTypeUse,
    BasicScheme,
    ContractIR,
    CredentialIdentity,
    Direction,
    EnumTypeUse,
    FieldRight,
    IdentityAccess,
    ObjectSchema,
    Operation,
    OptionalAccess,
    PagingPosition,
    Param,
    ProofPlacement,
    QueryScheme,
    QueryStyle,
    QueryWireKind,
    RefTypeUse,
    RequirementUnknown,
    Response,
    ResponseShape,
    RuleRequirement,
    ScalarTypeUse,
    SchemaPrincipal,
    SignatureScheme,
    SignedIdentity,
    TemplateSignature,
    TypeUse,
    UnknownKeysPolicy,
    UnknownQueryUnknown,
    ValueSchemeKey,
    ValueSourceIn,
)

_JSON_MEDIA: Final = "application/json"
_PAGING_PARAMS_DERIVATION: Final = "paging.params"
_QUERY_PART: Final = "query"
_PAYLOAD_SLOT: Final = "payload"
# The slots a success envelope may write beside the payload, which the boundary fills.
_ENVELOPE_SLOTS: Final = frozenset({_PAYLOAD_SLOT, "status", "path", "meta"})
# The slots a page template may write that the page reply fills: the response roles, the request path and status, and
# the format's `$meta` (ADR 0002 section 14). `$resource`, `$collection` and the item id slots are not yet.
_PAGE_SLOT: Final = "page"
_RENDERED_PAGE_SLOTS: Final = frozenset(
    {
        "items", "nextCursor", "previousCursor", "more", _PAGE_SLOT, "offset", "limit", "from", "to", "total",
        "totalPages", "self", "first", "previous", "next", "last", "nextSince", "complete", "path", "status", "meta",
    }
)  # fmt: skip
# The slot `$each` binds to each item inside its `$as` (ADR 0002 section 13): the renderer fills it.
_EACH_ITEM_SLOT: Final = "item"
_TOP_LEVEL_POINTER: Final = re.compile(r"/[^/]+")
_BUCKET_KEY_SOURCES: Final = frozenset({ValueSourceIn.PATH, ValueSourceIn.SCOPE, ValueSourceIn.PRINCIPAL})
# Header params the boundary consumes itself: the credentials and the CSRF token never reach the handler.
_CREDENTIAL_DERIVATION: Final = "identity.authenticate"
_CSRF_DERIVATION_PREFIX: Final = "csrf."


def refuse_kept_forms(ir: ContractIR, refusals: Refusals) -> None:
    """Refuses by name each form of the kept operations that no Python target serves."""
    _KeptForms(ir, refusals).read()
    refuse_response_header_forms(ir, refusals)
    refuse_identity_response_headers(ir, refusals)


def handler_headers(operation: Operation) -> list[Param]:
    """The header parameters that reach the handler: the credential and CSRF headers stay the boundary's."""
    return [param for param in operation.params.header if _reaches_the_handler(param)]


def _reaches_the_handler(param: Param) -> bool:
    if param.derived_from is None:
        return True

    derivation = param.derived_from.derivation

    return derivation != _CREDENTIAL_DERIVATION and not derivation.startswith(_CSRF_DERIVATION_PREFIX)


class _KeptForms:
    def __init__(self, ir: ContractIR, refusals: Refusals) -> None:
        self.ir = ir
        self.refusals = refusals
        self._read: set[str] = set()

    def read(self) -> None:
        if self.ir.extension_keys:
            self._after_v1("extensionKeys", "Typed extension values", IrPlace("/extensionKeys"))

        for index, operation in enumerate(self.ir.operations):
            self._operation(operation, IrPlace(f"/operations/{index}", operation.id))

    def _after_v1(self, form: str, description: str, at: IrPlace) -> None:
        self.refusals.waiting(form, description, at, Delivery.AFTER_V1)

    def _first_time(self, key: str) -> bool:
        if key in self._read:
            return False

        self._read.add(key)

        return True

    def _operation(self, operation: Operation, at: IrPlace) -> None:
        if isinstance(operation.unknown_query, UnknownQueryUnknown):
            self.refusals.unknown_value(operation.unknown_query.policy, at.below("unknownQuery", "policy"))

        self._access(operation, at)
        self._format(operation)
        self._page_templates(operation)
        self._requirements(operation, at)
        self._members_after_v1(operation, at)
        parts = {"path": operation.params.path, "query": operation.params.query, "header": handler_headers(operation)}

        for part, params in parts.items():
            for position, param in enumerate(params):
                self._param(part, param, at.below("params", part, position))

        if operation.input is not None:
            input_at = at.below("input")

            if operation.input.fields:
                self._after_v1("input.fields", "Body fields beside the input schema", input_at.below("fields"))

            self._type(operation.input.schema, input_at.below("schema"))

        for position, response in enumerate(operation.responses):
            self._response(response, at.below("responses", position))

        for position, error in enumerate(operation.errors):
            self._error(error.code, at.below("errors", position))

    def _access(self, operation: Operation, at: IrPlace) -> None:
        access = operation.access

        if isinstance(access, AccessUnknown):
            self.refusals.unknown_value(access.kind, at.below("access", "kind"))
        elif isinstance(access, IdentityAccess | OptionalAccess):
            self._identity(access.identity, at.below("access", "identity"))
            self._credential_schemes(access.schemes, at.below("access"))

    def _credential_schemes(self, scheme_ids: Sequence[str], at: IrPlace) -> None:
        """The query and HTTP Basic schemes no Python boundary reads a credential from, refused as on Node servers."""
        for scheme_id in scheme_ids:
            scheme = self.ir.schemes.get(scheme_id)

            if isinstance(scheme, QueryScheme | BasicScheme):
                self.refusals.waiting(
                    f"scheme.{scheme.kind}", f"A '{scheme.kind}' credential scheme", at, Delivery.CONSUMER
                )

    def _identity(self, identity_id: str, at: IrPlace) -> None:
        if not self._first_time(f"identity/{identity_id}"):
            return

        identity = self.ir.identities.get(identity_id)
        identity_at = IrPlace(f"/identities/{identity_id}")

        if identity is None:
            self.refusals.inconsistent("identity.undeclared", f"The identity '{identity_id}' is not declared", at)
            return

        if isinstance(identity, SignedIdentity):
            self._signature_scheme(identity.signed, identity_at.below("signed"))
        elif not isinstance(identity, CredentialIdentity):
            self.refusals.unknown_value(identity.kind, identity_at.below("kind"))
            return

        if not isinstance(identity.principal, SchemaPrincipal):
            self._after_v1("principal.variants", "A principal of several variants", identity_at.below("principal"))

    def _signature_scheme(self, scheme_id: str, at: IrPlace) -> None:
        scheme = self.ir.schemes.get(scheme_id)

        if not isinstance(scheme, SignatureScheme):
            self.refusals.inconsistent("scheme.unresolved", f"The signature scheme '{scheme_id}' is not declared", at)
            return

        signature_at = IrPlace(f"/schemes/{scheme_id}/signature")

        if not isinstance(scheme.signature, TemplateSignature):
            self._after_v1("signature.application", "A signature verified by the application", signature_at)
        elif not isinstance(scheme.signature.key, ValueSchemeKey):
            self._after_v1("signature.key.source", "A signature key read from the request", signature_at.below("key"))

    def _format(self, operation: Operation) -> None:
        format_id = operation.format
        wire_format = self.ir.formats.get(format_id)
        format_at = IrPlace(f"/formats/{format_id}")

        if wire_format is None:
            self.refusals.inconsistent("format.undeclared", f"The format '{format_id}' is not declared", format_at)
            return

        if wire_format.meta and self._first_time(f"format/{format_id}"):
            self._after_v1("format.meta", f"The meta members of the format '{format_id}'", format_at.below("meta"))

        shapes = {
            ResponseShape.ITEM: wire_format.success.item,
            ResponseShape.TABLE: wire_format.success.table,
            ResponseShape.LIST: wire_format.success.list,
            ResponseShape.PAGE: wire_format.success.page,
        }

        for response in operation.responses:
            shape_name = response.shape if isinstance(response.shape, ResponseShape) else None
            shape = None if shape_name is None else shapes.get(shape_name)

            if response.body is None or shape_name is None or shape is None:
                continue

            if not self._first_time(f"format/{format_id}/{shape_name.value}"):
                continue

            shape_at = format_at.below("success", shape_name.value)

            if shape.headers:
                self._after_v1("format.success.headers", "A success format header", shape_at.below("headers"))

            if shape_name is not ResponseShape.PAGE:
                self._envelope(shape.body.to_json(), shape_at.below("body"))

    def _page_templates(self, operation: Operation) -> None:
        """The page body (the style's own, or the format's page), the style's meta and headers, each read once: a slot
        the page reply does not fill would be dropped from the body, so it is refused by name."""
        style_id = operation.paging.style if operation.paging is not None else None
        style = None if style_id is None else self.ir.pagings.get(style_id)

        if style_id is None or style is None:
            return

        templates: list[tuple[JsonValue, IrPlace]] = []

        if self._first_time(f"paging/{style_id}"):
            response_at = IrPlace(f"/pagings/{style_id}/response")

            if style.response.body is not None:
                templates.append((style.response.body.to_json(), response_at.below("body")))

            for index, member in enumerate(style.response.meta):
                templates.append((member.value.to_json(), response_at.below("meta", index, "value")))

            for index, header in enumerate(style.response.headers):
                templates.append((header.value.to_json(), response_at.below("headers", index, "value")))

        page_format = self.ir.formats.get(operation.format)

        # The format's page is read once per style too: whether `$page` is filled depends on the style's position.
        format_page_key = f"page/{operation.format}/{style_id}"

        if style.response.body is None and page_format is not None and self._first_time(format_page_key):
            format_page_at = IrPlace(f"/formats/{operation.format}/success/page/body")
            templates.append((page_format.success.page.body.to_json(), format_page_at))

        # An offset style has no page number of its own: its base is not declared, so the page reply leaves `$page` out.
        rendered_slots = (
            _RENDERED_PAGE_SLOTS - {_PAGE_SLOT} if style.position == PagingPosition.OFFSET else _RENDERED_PAGE_SLOTS
        )

        for template, template_at in templates:
            unrendered = sorted(set(_template_slots(template)) - rendered_slots)

            if unrendered:
                named = ", ".join(f"'${slot}'" for slot in unrendered)
                self._after_v1(
                    "paging.response.slot", f"The page slots {named} of the paging style '{style_id}'", template_at
                )

    def _envelope(self, body: JsonValue, at: IrPlace) -> None:
        payload_path = _slot_path(body, _PAYLOAD_SLOT)

        if payload_path is None:
            self._after_v1(
                "format.success.envelope", "A success envelope that does not write `$payload` under named members", at
            )
            return

        if not payload_path:
            return

        for slot in sorted(set(_template_slots(body)) - _ENVELOPE_SLOTS):
            self._after_v1("format.success.slot", f"The success envelope slot '${slot}'", at)

    def _requirements(self, operation: Operation, at: IrPlace) -> None:
        for position, requirement in enumerate(operation.requires):
            requirement_at = at.below("requires", position)

            if isinstance(requirement, RequirementUnknown):
                self.refusals.unknown_value(requirement.kind, requirement_at.below("kind"))
                continue

            if not isinstance(requirement, RuleRequirement):
                continue

            if requirement.bucket is not None:
                self._bucket(requirement.bucket, requirement_at.below("bucket"))

            rule = self.ir.rules.get(requirement.rule)
            proof = None if rule is None else rule.proof

            if proof is not None and proof.in_ is not ProofPlacement.BODY:
                self._after_v1(
                    "rule.proof.placement",
                    f"A rule proof in '{proof.in_}'",
                    IrPlace(f"/rules/{requirement.rule}/proof/in"),
                )

    def _bucket(self, bucket_id: str, at: IrPlace) -> None:
        bucket = self.ir.buckets.get(bucket_id)

        if bucket is None:
            self.refusals.inconsistent("bucket.undeclared", f"The bucket '{bucket_id}' is not declared", at)
            return

        for position, source in enumerate(bucket.key):
            if source.in_ not in _BUCKET_KEY_SOURCES or source.name is None:
                self._after_v1(
                    "bucket.key",
                    f"A bucket key read from '{source.in_}'",
                    IrPlace(f"/buckets/{bucket_id}/key/{position}"),
                )

    def _members_after_v1(self, operation: Operation, at: IrPlace) -> None:
        members: Sequence[tuple[str, bool, str]] = (
            ("principalRequires", bool(operation.principal_requires), "A principal requirement"),
            ("bindings", bool(operation.bindings), "A principal binding"),
            ("upstream", bool(operation.upstream), "An upstream service call"),
            ("features", bool(operation.features), "An operation feature"),
            ("degradable", operation.degradable is not None, "A degradable operation"),
        )

        for member, present, description in members:
            if present:
                self._after_v1(member, description, at.below(member))

        for position, field_right in enumerate(operation.field_rights):
            if (
                field_right.direction is not Direction.OUTPUT
                and _TOP_LEVEL_POINTER.fullmatch(field_right.pointer) is None
            ):
                self._after_v1(
                    "fieldRight.nestedPointer",
                    "An input field right below the top level",
                    at.below("fieldRights", position, "pointer"),
                )

        for position, scope in enumerate(operation.scopes):
            if scope.source.in_ is not ValueSourceIn.PATH:
                self._after_v1(
                    "scope.source",
                    f"A scope id read from '{scope.source.in_}'",
                    at.below("scopes", position, "source"),
                )

    def _param(self, part: str, param: Param, at: IrPlace) -> None:
        if param.default is not OMITTED:
            self._after_v1("param.default", "A parameter default", at.below("default"))

        if param.wire is not None and param.wire.kind is QueryWireKind.LIST and param.wire.brackets:
            self._after_v1("query.list.brackets", "A query list in brackets form", at.below("wire", "brackets"))

        if isinstance(param.type, ScalarTypeUse | EnumTypeUse):
            self._type(param.type, at.below("type"))
            return

        if part == _QUERY_PART and _is_form_scalar_list(param):
            self._type(param.type, at.below("type"))
            return

        if param.derived_from is not None and param.derived_from.derivation == _PAGING_PARAMS_DERIVATION:
            return

        # Only a query parameter may be a list, so only its text names lists.
        description = (
            "A query parameter that is not a scalar, an enum or a list of them in the form style"
            if part == _QUERY_PART
            else f"A {part} parameter that is not a scalar or an enum"
        )
        self.refusals.waiting(
            f"param.{part}.structured",
            description,
            at.below("type"),
            Delivery.CONSUMER,
        )

    def _response(self, response: Response, at: IrPlace) -> None:
        for position, header in enumerate(response.headers):
            if header.derived_from is None:
                self._after_v1(
                    "response.header",
                    f"The response header '{header.name}', written by the route,",
                    at.below("headers", position),
                )

        if response.body is None:
            return

        if response.media != _JSON_MEDIA:
            self._after_v1("response.media", f"A '{response.media or 'missing'}' response body", at.below("media"))

        self._type(response.body, at.below("body"))

    def _error(self, code: str, at: IrPlace) -> None:
        if not self._first_time(f"error/{code}"):
            return

        declared = self.ir.errors.get(code)

        if declared is None:
            self.refusals.inconsistent(
                "error.code.undeclared", f"The error code '{code}' is not in the errors registry", at
            )
            return

        if declared.params is not None:
            self._schema(declared.params)

    def _type(self, type_use: TypeUse, at: IrPlace) -> None:
        if isinstance(type_use, ScalarTypeUse) and type_use.content is not None:
            self._after_v1("scalar.content", "A JSON string content", at.below("content"))
        elif isinstance(type_use, EnumTypeUse):
            self._enum(type_use.enum)
        elif isinstance(type_use, ArrayTypeUse):
            self._type(type_use.items, at.below("items"))
        elif isinstance(type_use, RefTypeUse):
            if type_use.unknown_keys is not None and type_use.unknown_keys.policy is UnknownKeysPolicy.KEEP:
                self._after_v1("unknownKeys.keep", "Unknown keys kept on a value", at.below("unknownKeys"))

            self._schema(type_use.schema)

    def _enum(self, enum_id: str) -> None:
        enum = self.ir.enums.get(enum_id)

        if enum is not None and enum.fallback is not None and self._first_time(f"enum/{enum_id}"):
            self._after_v1("enum.open", f"The open enum '{enum_id}'", IrPlace(f"/enums/{enum_id}/fallback"))

    def _schema(self, schema_id: str) -> None:
        schema = self.ir.schemas.get(schema_id)

        if not isinstance(schema, ObjectSchema) or not self._first_time(f"schema/{schema_id}"):
            return

        for position, member in enumerate(schema.properties):
            self._type(member.type, IrPlace(f"/schemas/{schema_id}/properties/{position}/type"))


def _input_right_below_the_top_level(field_right: FieldRight) -> bool:
    return field_right.direction is not Direction.OUTPUT and _TOP_LEVEL_POINTER.fullmatch(field_right.pointer) is None


def _slot_path(template: JsonValue, slot: str) -> list[str] | None:
    """The member names down to the slot, reached through named object members only."""
    if not isinstance(template, dict):
        return None

    if template.get("kind") == "slot":
        return [] if template.get("slot") == slot and template.get("path") == [] else None

    members = template.get("members")

    if template.get("kind") != "object" or not isinstance(members, list):
        return None

    for member in members:
        name = member.get("name") if isinstance(member, dict) else None

        if not isinstance(member, dict) or not isinstance(name, dict) or name.get("kind") != "text":
            continue

        rest = _slot_path(member.get("value"), slot)
        text = name.get("text")

        if rest is not None and isinstance(text, str):
            return [text, *rest]

    return None


def _template_slots(template: JsonValue) -> list[str]:
    """The slot names a template writes, at any depth, without the item each `$each` binds."""
    if isinstance(template, dict) and template.get("kind") == "each":
        source = template.get("of")
        bound = [slot for slot in _template_slots(template.get("as")) if slot != _EACH_ITEM_SLOT]
        return ([source] if isinstance(source, str) else []) + bound

    if isinstance(template, list):
        return [slot for value in template for slot in _template_slots(value)]

    if not isinstance(template, dict):
        return []

    own = template.get("slot")
    slots = [own] if template.get("kind") == "slot" and isinstance(own, str) else []

    return slots + [slot for value in template.values() for slot in _template_slots(value)]


def _is_form_scalar_list(param: Param) -> bool:
    """A query list every target decodes: a `list` wire in `form` style (repeated keys or one comma-separated value),
    each item a scalar or an enum."""
    wire = param.wire

    if wire is None or wire.kind is not QueryWireKind.LIST or wire.style is not QueryStyle.FORM:
        return False

    return isinstance(param.type, ArrayTypeUse) and isinstance(param.type.items, ScalarTypeUse | EnumTypeUse)
