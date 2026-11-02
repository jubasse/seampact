"""The DRF field a serializer builds for a contract type use (ADR 0027 "Types and validation"). The generated type
layer has already checked and converted every type, so a format or an enum is a typed field that keeps the converted
value, and strings are never trimmed or refused when blank. Under `rules: native` a value rule becomes DRF's own
argument where DRF has one (`min_length`, `max_length`, `min_value`, `max_value`); exclusive bounds and `multipleOf`
stay generated validators. Under `seampact-consistent` every value rule is a generated validator. A `pattern` is
always the framework-free pattern check on the IR's normalised pattern, never DRF's `RegexField`."""

from collections.abc import Callable
from enum import StrEnum
from typing import Final

from seampact.codegen.names import ApiNames
from seampact.codegen.printer import PythonModule, string_literal
from seampact.codegen.pydantic_models import number_literal
from seampact.codegen.refusals import Delivery, IrPlace, Refusals
from seampact.drf.expressions import Expression, Keyword, ListOf, call
from seampact.drf.python_types import FORMAT_TYPES, use_nullable
from seampact.ir.model import (
    ArrayTypeUse,
    EnumTypeUse,
    OpaqueTypeUse,
    Refinements,
    RefTypeUse,
    ScalarType,
    ScalarTypeUse,
    TypeUse,
)


class RulesMode(StrEnum):
    NATIVE = "native"
    SEAMPACT_CONSISTENT = "seampact-consistent"


_SERIALIZERS: Final = "_serializers"
_RUNTIME: Final = "_drf_runtime"
_NUMBER_FIELDS: Final = {ScalarType.INTEGER: "IntegerField", ScalarType.NUMBER: "FloatField"}


class SerializerFields:
    """`serializer_of` names the generated serializer of an object schema, by schema id."""

    def __init__(
        self,
        module: PythonModule,
        names: ApiNames,
        rules: RulesMode,
        refusals: Refusals,
        serializer_of: Callable[[str], str | None],
    ) -> None:
        self._module = module
        self._names = names
        self._rules = rules
        self._refusals = refusals
        self._serializer_of = serializer_of
        self._serializers = module.imported("rest_framework.serializers", _SERIALIZERS)
        self._runtime = module.imported("seampact.drf.runtime", _RUNTIME)

    def field(self, type_use: TypeUse, required: bool, nullable: bool, at: IrPlace) -> Expression:
        """The field of a member or a parameter: `required` unless optional, `allow_null` when null is allowed."""
        presence: list[Expression] = [] if required else ["required=False"]

        if nullable or use_nullable(type_use):
            presence.append("allow_null=True")

        return self._field(type_use, presence, at)

    def _field(self, type_use: TypeUse, presence: list[Expression], at: IrPlace) -> Expression:
        if isinstance(type_use, ScalarTypeUse):
            return self._scalar(type_use, presence, at)

        if isinstance(type_use, EnumTypeUse):
            name = self._names.enum_classes.get(type_use.enum)

            if name is None or type_use.narrowed_to is not None:
                self._refusals.waiting("enum.narrowed", "An enum narrowed at its use", at, Delivery.CONSUMER)

            enum_type = "str" if name is None else f"{self._module.imported('.schemas', '_schemas')}.{name}"
            return call(f"{self._runtime}.TypedValueField", [enum_type, *presence])

        if isinstance(type_use, RefTypeUse):
            serializer = self._serializer_of(type_use.schema)

            if serializer is None:
                self._refusals.inconsistent("schema.ref.missing", f"No object schema '{type_use.schema}'", at)
                return call(f"{self._serializers}.JSONField", presence)

            return call(serializer, presence)

        if isinstance(type_use, ArrayTypeUse):
            child = self._field(type_use.items, ["allow_null=True"] if use_nullable(type_use.items) else [], at)
            arguments: list[Expression] = [Keyword("child", child), *presence]
            arguments += self._lengths(type_use.min_items, type_use.max_items, [])
            return call(f"{self._serializers}.ListField", arguments)

        if isinstance(type_use, OpaqueTypeUse):
            return call(f"{self._serializers}.JSONField", presence)

        self._refusals.waiting(f"type.{type_use.kind}", f"A type use of kind '{type_use.kind}'", at, Delivery.CONSUMER)
        return call(f"{self._serializers}.JSONField", presence)

    def _scalar(self, type_use: ScalarTypeUse, presence: list[Expression], at: IrPlace) -> Expression:
        if not isinstance(type_use.type, ScalarType):
            self._refusals.unknown_value(type_use.type.raw, at.below("type"))
            return call(f"{self._serializers}.JSONField", presence)

        refinements = type_use.refinements
        validators = self._pattern(refinements)
        formatted = FORMAT_TYPES.get(type_use.format or "")

        if type_use.format is not None and formatted is None:
            self._refusals.waiting(
                f"format.{type_use.format}", f"The format '{type_use.format}'", at, Delivery.CONSUMER
            )

        if formatted is not None:
            value_type = f"{self._module.imported(formatted[0], formatted[1])}.{formatted[2]}"
            # A typed field has no bound argument of its own, so every bound is a validator.
            validators += self._length_validators(refinements)
            validators += _number_validators(self._runtime, refinements, RulesMode.SEAMPACT_CONSISTENT)
            return call(f"{self._runtime}.TypedValueField", [value_type, *presence, *_validators(validators)])

        if type_use.type is ScalarType.STRING:
            text_arguments: list[Expression] = ["trim_whitespace=False", "allow_blank=True", *presence]
            text_arguments += self._lengths(refinements.min_length, refinements.max_length, validators)
            return call(f"{self._serializers}.CharField", [*text_arguments, *_validators(validators)])

        if type_use.type is ScalarType.BOOLEAN:
            return call(f"{self._serializers}.BooleanField", presence)

        number_arguments: list[Expression] = list(presence)

        if self._rules is RulesMode.NATIVE:
            number_arguments += _native_bounds(refinements, type_use.type)

        validators += _number_validators(self._runtime, refinements, self._rules)
        field = f"{self._serializers}.{_NUMBER_FIELDS[type_use.type]}"
        return call(field, [*number_arguments, *_validators(validators)])

    def _lengths(self, minimum: int | None, maximum: int | None, validators: list[Expression]) -> list[Expression]:
        """DRF's own length arguments under `native`; otherwise the generated validator joins `validators`."""
        if self._rules is RulesMode.NATIVE:
            return [
                f"{key}={value}"
                for key, value in (("min_length", minimum), ("max_length", maximum))
                if value is not None
            ]

        validators += _length_validator(self._runtime, minimum, maximum)
        return []

    def _length_validators(self, refinements: Refinements) -> list[Expression]:
        return _length_validator(self._runtime, refinements.min_length, refinements.max_length)

    def _pattern(self, refinements: Refinements) -> list[Expression]:
        if refinements.pattern is None:
            return []

        return [call(f"{self._runtime}.pattern", [string_literal(refinements.pattern.normalized)])]


def _number_validators(runtime: str, refinements: Refinements, rules: RulesMode) -> list[Expression]:
    """The bounds DRF does not check itself (all of them under `seampact-consistent`), and `multipleOf`."""
    inclusive = rules is RulesMode.SEAMPACT_CONSISTENT
    bounds = [
        (key, value)
        for key, value in (
            ("minimum", refinements.minimum if inclusive else None),
            ("maximum", refinements.maximum if inclusive else None),
            ("exclusive_minimum", refinements.exclusive_minimum),
            ("exclusive_maximum", refinements.exclusive_maximum),
        )
        if value is not None
    ]
    validators: list[Expression] = []

    if bounds:
        validators.append(call(f"{runtime}.bounds", [f"{key}={string_literal(value)}" for key, value in bounds]))

    if refinements.multiple_of is not None:
        validators.append(call(f"{runtime}.multiple_of", [string_literal(refinements.multiple_of)]))

    return validators


def _length_validator(runtime: str, minimum: int | None, maximum: int | None) -> list[Expression]:
    arguments = [
        f"{key}={value}" for key, value in (("min_length", minimum), ("max_length", maximum)) if value is not None
    ]

    return [call(f"{runtime}.length", arguments)] if arguments else []


def _native_bounds(refinements: Refinements, scalar: ScalarType) -> list[Expression]:
    return [
        f"{key}={number_literal(value, scalar)}"
        for key, value in (("min_value", refinements.minimum), ("max_value", refinements.maximum))
        if value is not None
    ]


def _validators(validators: list[Expression]) -> list[Expression]:
    return [Keyword("validators", ListOf(tuple(validators)))] if validators else []
