"""The Pydantic emitter FastAPI and Ninja share (ADR 0026 "Types and validation"): a `StrEnum` per enum and a strict,
frozen model per object schema (`protected_namespaces=()`, unknown keys refused), each member typed by the runtime's
type layer (`WholeNumber`, `WireDateTime`, `WireUuid`, ...), and the value rules as Pydantic's own `Field`
constraints under `rules: native` or as the runtime's validators under `seampact-consistent`. A member both optional
and nullable is a `Field` of `seampact.hooks`. Framework names are imported under private aliases. The module also
holds the member table the runtime's wire codec reads."""

from collections.abc import Sequence
from decimal import Decimal
from enum import StrEnum
from typing import Final

from seampact.codegen.names import ApiNames
from seampact.codegen.printer import INDENT, PythonModule, fits, string_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.hydration import OMITTED
from seampact.ir.model import (
    ArrayTypeUse,
    ContractIR,
    EnumTypeUse,
    MapSchema,
    ObjectSchema,
    OpaqueTypeUse,
    Property,
    Refinements,
    RefTypeUse,
    ScalarType,
    ScalarTypeUse,
    TypeUse,
    UnionSchema,
)


class RulesMode(StrEnum):
    NATIVE = "native"
    SEAMPACT_CONSISTENT = "seampact-consistent"


_MODEL_CONFIG: Final = "_MODEL_CONFIG"
_OR_NONE: Final = " | None"
_MEMBERS_TABLE: Final = "SCHEMA_MEMBERS"
_NATIVE_BOUNDS: Final = {"minimum": "ge", "maximum": "le", "exclusive_minimum": "gt", "exclusive_maximum": "lt"}
_FORMAT_TYPES: Final = {
    "date-time": "WireDateTime",
    "date": "WireDate",
    "uuid": "WireUuid",
    "decimal": "WireDecimal",
}


class _Emission:
    def __init__(self, ir: ContractIR, names: ApiNames, rules: RulesMode, refusals: Refusals) -> None:
        self.ir = ir
        self.names = names
        self.rules = rules
        self.refusals = refusals
        self.module = PythonModule(f"The schema types of api '{ir.api.id}'.")
        self.pydantic = self.module.imported("pydantic", "_pydantic")
        self.typing = self.module.imported("typing", "_typing")
        self.seampact = self.module.imported("seampact.codegen.runtime.pydantic", "_seampact")
        self._objects = {key: value for key, value in ir.schemas.items() if isinstance(value, ObjectSchema)}
        self._defined: set[str] = set()

    def text(self) -> str:
        self.module.add_block(
            [
                f"{_MODEL_CONFIG} = {self.pydantic}.ConfigDict(",
                f"{INDENT}strict=True,",
                f"{INDENT}frozen=True,",
                f'{INDENT}extra="forbid",',
                f"{INDENT}protected_namespaces=(),",
                f'{INDENT}regex_engine="rust-regex",',
                f"{INDENT}allow_inf_nan=False,",
                ")",
            ]
        )

        for enum_id in sorted(self.ir.enums):
            self._enum(enum_id)

        for schema_id in self._dependency_order():
            self._model(schema_id, self._objects[schema_id], IrPlace(f"/schemas/{schema_id}"))

        for schema_id, schema in sorted(self.ir.schemas.items()):
            at = IrPlace(f"/schemas/{schema_id}")

            if isinstance(schema, ObjectSchema):
                continue

            if isinstance(schema, MapSchema | UnionSchema):
                self.refusals.waiting(f"schema.{schema.kind}", f"A {schema.kind} schema", at, Delivery.CONSUMER)
            else:
                self.refusals.unknown_value(schema.kind, at.below("kind"))

        self._members_table()

        return self.module.text()

    def _dependency_order(self) -> list[str]:
        """Object schemas by id, each after the schemas its members name, so a model names only defined classes; a
        cycle names the later class as a string."""
        ordered: list[str] = []
        visiting: set[str] = set()

        def visit(schema_id: str) -> None:
            if schema_id in ordered or schema_id in visiting:
                return

            visiting.add(schema_id)

            for member in self._objects[schema_id].properties:
                for referenced in _referenced_schemas(member.type):
                    if referenced in self._objects:
                        visit(referenced)

            ordered.append(schema_id)

        for schema_id in sorted(self._objects):
            visit(schema_id)

        return ordered

    def _enum(self, enum_id: str) -> None:
        enum_module = self.module.imported("enum", "_enum")
        lines = [f"class {self.names.enum_classes[enum_id]}({enum_module}.StrEnum):"]

        for value, member in self.names.enum_members[enum_id].items():
            lines.append(f"{INDENT}{member} = {string_literal(value)}")

        self.module.add_block(lines)

    def _model(self, schema_id: str, schema: ObjectSchema, at: IrPlace) -> None:
        lines = [f"class {self.names.schema_classes[schema_id]}({self.pydantic}.BaseModel):"]
        lines.append(f"{INDENT}model_config = {_MODEL_CONFIG}")
        members = self.names.members.get(schema_id, {})

        if schema.properties:
            lines.append("")

        for index, member in enumerate(schema.properties):
            attribute = members.get(member.name)

            if attribute is not None:
                lines.extend(self._member(attribute, member, at.below("properties", index)))

        self._defined.add(schema_id)
        self.module.add_block(lines)

    def _member(self, attribute: str, member: Property, at: IrPlace) -> list[str]:
        annotation = self.annotation(member.type, at.below("type"))
        nullable = member.nullable or _use_nullable(member.type)

        if member.default is not OMITTED:
            self.refusals.waiting("member.default", "A member with a default", at.below("default"), Delivery.CONSUMER)

        if member.optional and nullable:
            hooks = self.module.imported("seampact.hooks", "_hooks")
            return _wrapped(f"{INDENT}{attribute}: {hooks}.Field[", annotation, f" | None] = {hooks}.Absent.ABSENT")

        if member.optional:
            return _wrapped_in(f"{INDENT}{attribute}: {self.seampact}.Omittable[", annotation, "] = None")

        return _wrapped(f"{INDENT}{attribute}: ", annotation, " | None" if nullable else "")

    def annotation(self, type_use: TypeUse, at: IrPlace) -> list[str]:
        """The annotation of a type use: one item, or the items of an `Annotated` that the printer may explode."""
        if isinstance(type_use, ScalarTypeUse):
            return self._scalar(type_use, at)

        if isinstance(type_use, EnumTypeUse):
            return self._enum_use(type_use, at)

        if isinstance(type_use, RefTypeUse):
            schema = self.ir.schemas.get(type_use.schema)
            name = self.names.schema_classes.get(type_use.schema)

            if not isinstance(schema, ObjectSchema) or name is None:
                self.refusals.inconsistent("schema.ref.missing", f"No object schema '{type_use.schema}'", at)
                return ["object"]

            return [name if type_use.schema in self._defined else string_literal(name)]

        if isinstance(type_use, ArrayTypeUse):
            items = _joined(self.annotation(type_use.items, at.below("items")))
            rules = self._length_rules(type_use.min_items, type_use.max_items)
            return [f"list[{items}]"] if not rules else [f"{self.typing}.Annotated[", f"list[{items}]", *rules]

        if isinstance(type_use, OpaqueTypeUse):
            return [f"{self.pydantic}.JsonValue"]

        self.refusals.waiting(f"type.{type_use.kind}", f"A type use of kind '{type_use.kind}'", at, Delivery.CONSUMER)
        return ["object"]

    def _enum_use(self, type_use: EnumTypeUse, at: IrPlace) -> list[str]:
        if type_use.narrowed_to is not None:
            self.refusals.waiting("enum.narrowed", "An enum narrowed at its use", at, Delivery.CONSUMER)

        name = self.names.enum_classes.get(type_use.enum)

        if name is None:
            self.refusals.inconsistent("enum.missing", f"No enum '{type_use.enum}'", at)
            return ["str"]

        return [f"{self.typing}.Annotated[", name, f"{self.seampact}.enum_from_wire({name})"]

    def _scalar(self, type_use: ScalarTypeUse, at: IrPlace) -> list[str]:
        if not isinstance(type_use.type, ScalarType):
            self.refusals.unknown_value(type_use.type.raw, at.below("type"))
            return ["object"]

        base = self._scalar_base(type_use, type_use.type, at)
        rules = self._value_rules(type_use.refinements, type_use.type, at.below("refinements"))

        return [base] if not rules else [f"{self.typing}.Annotated[", base, *rules]

    def _scalar_base(self, type_use: ScalarTypeUse, scalar: ScalarType, at: IrPlace) -> str:
        if type_use.format is not None:
            wire_type = _FORMAT_TYPES.get(type_use.format)

            if wire_type is None:
                self.refusals.waiting(
                    f"format.{type_use.format}", f"The format '{type_use.format}'", at, Delivery.CONSUMER
                )
                return "str"

            return f"{self.seampact}.{wire_type}"

        if scalar is ScalarType.INTEGER:
            return f"{self.seampact}.WholeNumber"

        return {ScalarType.NUMBER: "float", ScalarType.BOOLEAN: "bool"}.get(scalar, "str")

    def _value_rules(self, refinements: Refinements, scalar: ScalarType, at: IrPlace) -> list[str]:
        bounds = [
            (key, value)
            for key, value in (
                ("minimum", refinements.minimum),
                ("maximum", refinements.maximum),
                ("exclusive_minimum", refinements.exclusive_minimum),
                ("exclusive_maximum", refinements.exclusive_maximum),
            )
            if value is not None
        ]
        pattern = None if refinements.pattern is None else string_literal(refinements.pattern.normalized)

        if self.rules is RulesMode.NATIVE:
            arguments = _length_arguments(refinements.min_length, refinements.max_length)
            arguments += [f"{_NATIVE_BOUNDS[key]}={number_literal(value, scalar)}" for key, value in bounds]

            if refinements.multiple_of is not None:
                arguments.append(f"multiple_of={number_literal(refinements.multiple_of, scalar)}")

            if pattern is not None:
                arguments.append(f"pattern={pattern}")

            return [f"{self.pydantic}.Field({', '.join(arguments)})"] if arguments else []

        rules = self._length_rules(refinements.min_length, refinements.max_length)

        if bounds:
            bound_arguments = ", ".join(f"{key}={string_literal(value)}" for key, value in bounds)
            rules.append(f"{self.seampact}.bounds({bound_arguments})")

        if refinements.multiple_of is not None:
            rules.append(f"{self.seampact}.multiple_of({string_literal(refinements.multiple_of)})")

        if pattern is not None:
            rules.append(f"{self.seampact}.pattern({pattern})")

        return rules

    def _length_rules(self, minimum: int | None, maximum: int | None) -> list[str]:
        arguments = _length_arguments(minimum, maximum)

        if not arguments:
            return []

        helper = f"{self.seampact}.length" if self.rules is RulesMode.SEAMPACT_CONSISTENT else f"{self.pydantic}.Field"

        return [f"{helper}({', '.join(arguments)})"]

    def _members_table(self) -> None:
        lines = [f"{_MEMBERS_TABLE}: {self.typing}.Final = {{"]

        for schema_id, members in self.names.members.items():
            if not members:
                lines.append(f"{INDENT}{string_literal(schema_id)}: {{}},")
                continue

            lines.append(f"{INDENT}{string_literal(schema_id)}: {{")
            lines.extend(
                f"{INDENT * 2}{string_literal(wire)}: {string_literal(name)}," for wire, name in members.items()
            )
            lines.append(f"{INDENT}}},")

        lines.append("}")
        self.module.add_block(lines)


def pydantic_schemas_module(ir: ContractIR, names: ApiNames, rules: RulesMode, refusals: Refusals) -> str:
    """The `schemas` module of an api: its enums, its object models and their member table."""
    return _Emission(ir, names, rules, refusals).text()


def _joined(items: Sequence[str]) -> str:
    if len(items) == 1:
        return items[0]

    return items[0] + ", ".join(items[1:]) + "]"


def _wrapped_in(prefix: str, annotation: Sequence[str], suffix: str) -> list[str]:
    """A member whose annotation sits in one subscript (`prefix` ends with `[`, `suffix` starts with `]`), exploded as
    ruff writes it: the annotation on its own line, else its `Annotated` items one per line with a trailing comma."""
    joined = _joined(annotation)
    single = f"{prefix}{joined}{suffix}"

    if fits(single):
        return [single]

    # ruff parenthesizes the default instead when the annotation then fits on the member's line.
    annotated, equals, default = suffix.partition(" = ")

    if equals and fits(f"{prefix}{joined}{annotated} = ("):
        return [f"{prefix}{joined}{annotated} = (", f"{INDENT * 2}{default}", f"{INDENT})"]

    if fits(f"{INDENT * 2}{joined}") or len(annotation) == 1:
        return [prefix, f"{INDENT * 2}{joined}", f"{INDENT}{suffix}"]

    items = [f"{INDENT * 3}{item}," for item in annotation[1:]]

    return [prefix, f"{INDENT * 2}{annotation[0]}", *items, f"{INDENT * 2}]", f"{INDENT}{suffix}"]


def _wrapped(prefix: str, annotation: Sequence[str], suffix: str) -> list[str]:
    """The member line, or, past the line length, its `Annotated` items one per line with a trailing comma."""
    single = f"{prefix}{_joined(annotation)}{suffix}"

    if fits(single) or len(annotation) == 1:
        return [single]

    items = [f"{INDENT * 2}{item}," for item in annotation[1:]]

    if not suffix.startswith(_OR_NONE):
        return [f"{prefix}{annotation[0]}", *items, f"{INDENT}]{suffix}"]

    # ruff parenthesizes an exploded annotation that a `| None` follows.
    default = suffix.removeprefix(_OR_NONE)
    nested = [f"{INDENT}{item}" for item in items]

    return [
        f"{prefix}(",
        f"{INDENT * 2}{annotation[0]}",
        *nested,
        f"{INDENT * 2}]",
        f"{INDENT * 2}| None",
        f"{INDENT}){default}",
    ]


def _referenced_schemas(type_use: TypeUse) -> list[str]:
    if isinstance(type_use, RefTypeUse):
        return [type_use.schema]

    return _referenced_schemas(type_use.items) if isinstance(type_use, ArrayTypeUse) else []


def _use_nullable(type_use: TypeUse) -> bool:
    nullable_uses = ScalarTypeUse | EnumTypeUse | RefTypeUse | ArrayTypeUse

    return isinstance(type_use, nullable_uses) and type_use.nullable is True


def _length_arguments(minimum: int | None, maximum: int | None) -> list[str]:
    return [f"{key}={value}" for key, value in (("min_length", minimum), ("max_length", maximum)) if value is not None]


def number_literal(literal: str, scalar: ScalarType) -> str:
    exact = Decimal(literal)

    if scalar is ScalarType.INTEGER and exact == exact.to_integral_value():
        return str(int(exact))

    return repr(float(exact))
