"""The `schemas` module of an api on the DRF target (ADR 0027 "Types and validation"): a `StrEnum` per enum and a
frozen, slotted, keyword-only dataclass per object schema, which the handler reads. A member both optional and
nullable is a `Field` of `seampact.hooks`, absent by default; an optional member that is not nullable is `None` when
absent. Value rules are not part of the types: the serializers check them."""

from collections.abc import Sequence

from seampact.codegen.names import ApiNames
from seampact.codegen.printer import INDENT, PythonModule, string_literal
from seampact.codegen.redacted_members import redacted_dataclass_reprs, redacted_marker_block
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.drf.python_types import PythonTypes, use_nullable
from seampact.ir.hydration import OMITTED
from seampact.ir.model import ContractIR, MapSchema, ObjectSchema, Property, ScalarTypeUse, TypeUse, UnionSchema

DATACLASS_DECORATOR = "dataclass(frozen=True, slots=True, kw_only=True)"
_REDACTED_DATACLASS_DECORATOR = "dataclass(frozen=True, slots=True, kw_only=True, repr=False)"


class FrozenDataclasses:
    """The frozen dataclasses of one generated module. A class with sensitive members gets the generated `__repr__`
    and `__rich_repr__` that print them `[redacted]` (ADR 0026 "Redaction"); the module declares the marker they print
    once, before its first use."""

    def __init__(self, module: PythonModule) -> None:
        self.module = module
        self._marker_declared = False

    def block(
        self, class_name: str, body: Sequence[str], attributes: Sequence[str], redacted: Sequence[str]
    ) -> list[str]:
        """The class with its `body` (docstring and member lines); `attributes` names its members in order."""
        dataclasses = self.module.imported("dataclasses", "_dataclasses")

        if not redacted:
            return [f"@{dataclasses}.{DATACLASS_DECORATOR}", f"class {class_name}:", *body]

        if not self._marker_declared:
            self._marker_declared = True
            self.module.add_block(redacted_marker_block())

        abc = self.module.imported("collections.abc", "_abc")
        reprs = redacted_dataclass_reprs(class_name, attributes, redacted, abc)

        return [f"@{dataclasses}.{_REDACTED_DATACLASS_DECORATOR}", f"class {class_name}:", *body, *reprs]


def is_sensitive_use(type_use: TypeUse) -> bool:
    """A use of a declared scalar marked sensitive (ADR 0003 section 6)."""
    return isinstance(type_use, ScalarTypeUse) and type_use.sensitive is True


def dataclass_schemas_module(ir: ContractIR, names: ApiNames, refusals: Refusals) -> str:
    module = PythonModule(f"The schema types of api '{ir.api.id}'.")
    defined: set[str] = set()
    types = PythonTypes(ir, names, refusals, defined=defined)
    dataclasses = FrozenDataclasses(module)

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
            module.add_block(_dataclass(dataclasses, types, names, schema_id, schema, at, refusals))
            defined.add(schema_id)
        elif isinstance(schema, MapSchema | UnionSchema):
            refusals.waiting(f"schema.{schema.kind}", f"A {schema.kind} schema", at, Delivery.CONSUMER)
        else:
            refusals.unknown_value(schema.kind, at.below("kind"))

    return module.text()


def _dataclass(
    dataclasses: FrozenDataclasses,
    types: PythonTypes,
    names: ApiNames,
    schema_id: str,
    schema: ObjectSchema,
    at: IrPlace,
    refusals: Refusals,
) -> list[str]:
    module = dataclasses.module
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
    attributes = [attribute for member in schema.properties if (attribute := members.get(member.name)) is not None]
    class_name = names.schema_classes[schema_id]

    if not body:
        return dataclasses.block(
            class_name, [f'{INDENT}"""The schema \'{schema_id}\', which has no member."""'], [], []
        )

    return dataclasses.block(class_name, body, attributes, redacted)


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
