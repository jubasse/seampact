"""The DRF field a serializer builds for a contract type use (ADR 0027 "Types and validation"). The generated type
layer has already checked and converted every type, so a format or an enum is a typed field that keeps the converted
value, and a string is the runtime text field: never trimmed, it runs every rule on an empty string too. Under
`rules: native` a value rule becomes DRF's own argument where DRF has one (`min_length`, `max_length`, `min_value`,
`max_value`); a rule DRF has no argument for (exclusive bounds, `multipleOf`, any rule on a formatted use) is refused
at generate until a later release checks it. Under `seampact-consistent` every value rule is a generated validator. A
`pattern` is always the framework-free pattern check on the IR's normalised pattern, never DRF's `RegexField`."""

from collections.abc import Callable
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
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
_RULE_KEYS: Final = (
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
)
# The rules of a number that DRF's own arguments (`min_value`, `max_value`) do not cover.
_NUMBER_RULES_DRF_LEAVES: Final = ("exclusiveMinimum", "exclusiveMaximum", "multipleOf")


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
        self._runtime = module.imported("seampact.drf.runtime", _RUNTIME)

    @property
    def _serializers(self) -> str:
        """DRF's serializers module, imported once a field needs it."""
        return self._module.imported("rest_framework.serializers", _SERIALIZERS)

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
            self._refuse_unchecked_under_native(refinements, _RULE_KEYS, f"a '{type_use.format}' use", at)
            validators += self._length_validators(refinements)
            validators += _number_validators(self._runtime, refinements, RulesMode.SEAMPACT_CONSISTENT)
            return call(f"{self._runtime}.TypedValueField", [value_type, *presence, *_validators(validators)])

        if type_use.type is ScalarType.STRING:
            text_arguments: list[Expression] = list(presence)
            text_arguments += self._lengths(refinements.min_length, refinements.max_length, validators)
            return call(f"{self._runtime}.ContractTextField", [*text_arguments, *_validators(validators)])

        if type_use.type is ScalarType.BOOLEAN:
            return call(f"{self._serializers}.BooleanField", presence)

        number_arguments: list[Expression] = list(presence)

        if self._rules is RulesMode.NATIVE:
            self._refuse_unchecked_under_native(refinements, _NUMBER_RULES_DRF_LEAVES, f"a '{type_use.type}' use", at)
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

    def _refuse_unchecked_under_native(
        self, refinements: Refinements, keys: tuple[str, ...], use: str, at: IrPlace
    ) -> None:
        """Under `native`, the rules DRF has no argument for on this field are refused until the release that runs
        the DRF steps checks them, never left to fail at request time."""
        if self._rules is not RulesMode.NATIVE:
            return

        for key, value in _rule_values(refinements).items():
            if key in keys and value is not None:
                self._refusals.add(
                    f"rule.{key}.unsupported",
                    f"The rule '{key}' on {use} has no DRF check under `rules: native` in this release.",
                    "Remove the rule from this use until a later seampact-drf release checks it.",
                    at.below("refinements", key),
                )

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


def _rule_values(refinements: Refinements) -> dict[str, object]:
    """The value rules by their contract key, None when absent."""
    return {
        "minLength": refinements.min_length,
        "maxLength": refinements.max_length,
        "minimum": refinements.minimum,
        "maximum": refinements.maximum,
        "exclusiveMinimum": refinements.exclusive_minimum,
        "exclusiveMaximum": refinements.exclusive_maximum,
        "multipleOf": refinements.multiple_of,
    }


def _length_validator(runtime: str, minimum: int | None, maximum: int | None) -> list[Expression]:
    arguments = [
        f"{key}={value}" for key, value in (("min_length", minimum), ("max_length", maximum)) if value is not None
    ]

    return [call(f"{runtime}.length", arguments)] if arguments else []


def _native_bounds(refinements: Refinements, scalar: ScalarType) -> list[Expression]:
    bounds = (("min_value", refinements.minimum, ROUND_CEILING), ("max_value", refinements.maximum, ROUND_FLOOR))

    return [f"{key}={_bound_literal(value, scalar, rounding)}" for key, value, rounding in bounds if value is not None]


# An integer use's fractional bound is the nearest whole number inside it: `minimum: 1.5` admits 2 and above.
def _bound_literal(value: str, scalar: ScalarType, rounding: str) -> str:
    if scalar is not ScalarType.INTEGER:
        return number_literal(value, scalar)

    return format(Decimal(value).to_integral_value(rounding=rounding), "f")


def _validators(validators: list[Expression]) -> list[Expression]:
    return [Keyword("validators", ListOf(tuple(validators)))] if validators else []
