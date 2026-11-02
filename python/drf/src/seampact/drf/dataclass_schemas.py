"""The `schemas` module of an api on the DRF target (ADR 0027 "Types and validation"): a `StrEnum` per enum and a
frozen, slotted, keyword-only dataclass per object schema, which the handler reads. A member both optional and
nullable is a `Field` of `seampact.hooks`, absent by default; an optional member that is not nullable is `None` when
absent. Value rules are not part of the types: the serializers check them."""

from collections.abc import Sequence

from seampact.codegen.names import ApiNames
from seampact.codegen.printer import INDENT, PythonModule, string_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.drf.python_types import PythonTypes, use_nullable
from seampact.ir.hydration import OMITTED
from seampact.ir.model import ContractIR, MapSchema, ObjectSchema, Property, ScalarTypeUse, TypeUse, UnionSchema

DATACLASS_DECORATOR = "dataclass(frozen=True, slots=True, kw_only=True)"
_REDACTED_DATACLASS_DECORATOR = "dataclass(frozen=True, slots=True, kw_only=True, repr=False)"


def dataclass_head(module: PythonModule, class_name: str, redacted: Sequence[str]) -> list[str]:
    """The decorator and class lines of a generated dataclass; with `redacted` attributes it derives from
    `RedactedRepr`, so its repr hides them."""
    dataclasses = module.imported("dataclasses", "_dataclasses")

    if not redacted:
        return [f"@{dataclasses}.{DATACLASS_DECORATOR}", f"class {class_name}:"]

    runtime = module.imported("seampact.drf.runtime", "_drf_runtime")

    return [f"@{dataclasses}.{_REDACTED_DATACLASS_DECORATOR}", f"class {class_name}({runtime}.RedactedRepr):"]


def redacted_fields(module: PythonModule, redacted: Sequence[str]) -> list[str]:
    """The class body line naming the attributes a `RedactedRepr` hides; none without any."""
    if not redacted:
        return []

    typing = module.imported("typing", "_typing")
    attributes = ", ".join(string_literal(attribute) for attribute in redacted)

    return [f"{INDENT}_REDACTED_FIELDS: {typing}.ClassVar[frozenset[str]] = frozenset({{{attributes}}})"]


def is_sensitive_use(type_use: TypeUse) -> bool:
    """A use of a declared scalar marked sensitive (ADR 0003 section 6)."""
    return isinstance(type_use, ScalarTypeUse) and type_use.sensitive is True


def dataclass_schemas_module(ir: ContractIR, names: ApiNames, refusals: Refusals) -> str:
    module = PythonModule(f"The schema types of api '{ir.api.id}'.")
    defined: set[str] = set()
    types = PythonTypes(ir, names, refusals, defined=defined)

    for enum_id in sorted(ir.enums):
        enum = module.imported("enum", "_enum")
        module.add_block(
            [
                f"class {names.enum_classes[enum_id]}({enum}.StrEnum):",
                *(
                    f"{INDENT}{member} = {string_literal(value)}"
                    for value, member in names.enum_members[enum_id].items()
                ),
            ]
        )

    for schema_id, schema in sorted(ir.schemas.items()):
        at = IrPlace(f"/schemas/{schema_id}")

        if isinstance(schema, ObjectSchema):
            module.add_block(_dataclass(module, types, names, schema_id, schema, at, refusals))
            defined.add(schema_id)
        elif isinstance(schema, MapSchema | UnionSchema):
            refusals.waiting(f"schema.{schema.kind}", f"A {schema.kind} schema", at, Delivery.CONSUMER)
        else:
            refusals.unknown_value(schema.kind, at.below("kind"))

    return module.text()


def _dataclass(
    module: PythonModule,
    types: PythonTypes,
    names: ApiNames,
    schema_id: str,
    schema: ObjectSchema,
    at: IrPlace,
    refusals: Refusals,
) -> list[str]:
    members = names.members.get(schema_id, {})
    body = [
        _member(module, types, attribute, member, at.below("properties", index), refusals)
        for index, member in enumerate(schema.properties)
        if (attribute := members.get(member.name)) is not None
    ]
    redacted = [
        attribute
        for member in schema.properties
        if (member.sensitive or is_sensitive_use(member.type)) and (attribute := members.get(member.name)) is not None
    ]
    lines = dataclass_head(module, names.schema_classes[schema_id], redacted)

    if not body:
        return [*lines, f'{INDENT}"""The schema \'{schema_id}\', which has no member."""']

    return [*lines, *redacted_fields(module, redacted), *body]


def _member(
    module: PythonModule, types: PythonTypes, attribute: str, member: Property, at: IrPlace, refusals: Refusals
) -> str:
    if member.default is not OMITTED:
        refusals.waiting("member.default", "A member with a default", at.below("default"), Delivery.CONSUMER)

    type_nullable = use_nullable(member.type)
    suffix = " | None" if (member.optional or member.nullable) and not type_nullable else ""
    annotation = types.annotation(module, member.type, at.below("type"), suffix)

    if member.optional and (member.nullable or type_nullable):
        hooks = module.imported("seampact.hooks", "_hooks")
        return f"{INDENT}{attribute}: {hooks}.Field[{annotation}] = {hooks}.Absent.ABSENT"

    return f"{INDENT}{attribute}: {annotation}{' = None' if member.optional else ''}"
