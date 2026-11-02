"""The Python annotation of a contract type use in the dataclass types of the DRF target: `str`, `int`, `float` and
`bool` for scalars, `datetime`, `date`, `UUID` and `Decimal` for the formats the type layer converts, the generated
`StrEnum` and dataclass of an enum or an object schema, `list` for an array and `object` for an opaque value, with
`| None` when the use is nullable. An annotation naming an object schema written further down the schemas module is
quoted whole, since a class body evaluates its annotations. A form the target does not serve is refused by name."""

from collections.abc import Collection
from typing import Final

from seampact.codegen.names import ApiNames
from seampact.codegen.printer import PythonModule, string_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.ir.model import (
    ArrayTypeUse,
    ContractIR,
    EnumTypeUse,
    ObjectSchema,
    OpaqueTypeUse,
    RefTypeUse,
    ScalarType,
    ScalarTypeUse,
    TypeUse,
)

FORMAT_TYPES: Final = {
    "date-time": ("datetime", "_datetime", "datetime"),
    "date": ("datetime", "_datetime", "date"),
    "uuid": ("uuid", "_uuid", "UUID"),
    "decimal": ("decimal", "_decimal", "Decimal"),
}
_SCALAR_TYPES: Final = {
    ScalarType.STRING: "str",
    ScalarType.INTEGER: "int",
    ScalarType.NUMBER: "float",
    ScalarType.BOOLEAN: "bool",
}
_NULLABLE: Final = " | None"


class PythonTypes:
    """`schemas` is the prefix of a generated schema type (`_schemas.` outside the schemas module); `defined`, when
    given, holds the object schemas already written above, so a later one is named as a string."""

    def __init__(
        self,
        ir: ContractIR,
        names: ApiNames,
        refusals: Refusals,
        schemas: str = "",
        defined: Collection[str] | None = None,
    ) -> None:
        self._ir = ir
        self._names = names
        self._refusals = refusals
        self._schemas = schemas
        self._defined = defined
        self._names_later_class = False

    def annotation(self, module: PythonModule, type_use: TypeUse, at: IrPlace, suffix: str = "") -> str:
        """The annotation, with `| None` when the use itself is nullable, then `suffix`; quoted whole when it names a
        class written further down."""
        self._names_later_class = False
        annotation = self._nullable(module, type_use, at) + suffix

        return string_literal(annotation) if self._names_later_class else annotation

    def _nullable(self, module: PythonModule, type_use: TypeUse, at: IrPlace) -> str:
        base = self.base(module, type_use, at)

        return base + _NULLABLE if use_nullable(type_use) else base

    def base(self, module: PythonModule, type_use: TypeUse, at: IrPlace) -> str:
        if isinstance(type_use, ScalarTypeUse):
            return self._scalar(module, type_use, at)

        if isinstance(type_use, EnumTypeUse):
            return self._enum(type_use, at)

        if isinstance(type_use, RefTypeUse):
            return self._object(type_use, at)

        if isinstance(type_use, ArrayTypeUse):
            return f"list[{self._nullable(module, type_use.items, at.below('items'))}]"

        if isinstance(type_use, OpaqueTypeUse):
            return "object"

        self._refusals.waiting(f"type.{type_use.kind}", f"A type use of kind '{type_use.kind}'", at, Delivery.CONSUMER)
        return "object"

    def _scalar(self, module: PythonModule, type_use: ScalarTypeUse, at: IrPlace) -> str:
        if not isinstance(type_use.type, ScalarType):
            self._refusals.unknown_value(type_use.type.raw, at.below("type"))
            return "object"

        if type_use.format is None:
            return _SCALAR_TYPES[type_use.type]

        formatted = FORMAT_TYPES.get(type_use.format)

        if formatted is None:
            self._refusals.waiting(
                f"format.{type_use.format}", f"The format '{type_use.format}'", at, Delivery.CONSUMER
            )
            return "str"

        module_name, alias, type_name = formatted

        return f"{module.imported(module_name, alias)}.{type_name}"

    def _enum(self, type_use: EnumTypeUse, at: IrPlace) -> str:
        if type_use.narrowed_to is not None:
            self._refusals.waiting("enum.narrowed", "An enum narrowed at its use", at, Delivery.CONSUMER)

        name = self._names.enum_classes.get(type_use.enum)

        if name is None:
            self._refusals.inconsistent("enum.missing", f"No enum '{type_use.enum}'", at)
            return "str"

        return self._schemas + name

    def _object(self, type_use: RefTypeUse, at: IrPlace) -> str:
        name = self._names.schema_classes.get(type_use.schema)

        if not isinstance(self._ir.schemas.get(type_use.schema), ObjectSchema) or name is None:
            self._refusals.inconsistent("schema.ref.missing", f"No object schema '{type_use.schema}'", at)
            return "object"

        if self._defined is not None and type_use.schema not in self._defined:
            self._names_later_class = True

        return self._schemas + name


def use_nullable(type_use: TypeUse) -> bool:
    nullable_uses = ScalarTypeUse | EnumTypeUse | RefTypeUse | ArrayTypeUse | OpaqueTypeUse

    return isinstance(type_use, nullable_uses) and type_use.nullable is True
