"""The base of the generated serializers and the typed field (ADR 0027 "Types and validation"). A generated
serializer builds its fields in `get_fields()`, never as class attributes, so a contract member named `data`,
`errors` or `fields` never shadows the serializer's own attribute. The generated type layer runs first and converts
date-times, dates, UUIDs, decimals and enum members, so their field only checks the converted type and keeps the
value as it is, with the offset a date-time was sent with. A contract string is a text field that keeps the text as
sent, NUL and lone surrogates included, and runs every validator, on an empty string too."""

from collections.abc import Callable, Sequence
from typing import Any, Final

from django.core.validators import MaxLengthValidator, MinLengthValidator
from rest_framework import serializers

# DRF's stubs type a serializer's fields with `Any`; the generated `get_fields()` returns this.
type SerializerFields = dict[str, serializers.Field[Any, Any, Any, Any]]

_WRONG_TYPE: Final = "type"


class ContractSerializer(serializers.Serializer[object]):
    """Validates the decoded tree of one input part or object schema; it never saves or renders an instance."""


class TypedValueField[V](serializers.Field[V, object, V, object]):
    """Keeps a value of exactly `value_type` as the type layer gave it, so a date field refuses a date-time; anything
    else is refused with the rule `type`."""

    def __init__(
        self,
        value_type: type[V],
        *,
        required: bool | None = None,
        allow_null: bool = False,
        validators: Sequence[Callable[[V], None]] | None = None,
    ) -> None:
        super().__init__(required=required, allow_null=allow_null, validators=validators)
        self.value_type = value_type

    def to_internal_value(self, data: object) -> V:
        if type(data) is self.value_type and isinstance(data, self.value_type):
            return data

        raise serializers.ValidationError("Not a value of the contract's type.", code=_WRONG_TYPE)

    def to_representation(self, value: V) -> V:
        return value


class ContractTextField(TypedValueField[str]):
    """A contract string. DRF's `CharField` skips its validators on an empty string and refuses NUL and lone
    surrogates, which the contract accepts. `min_length` and `max_length` are Django's validators, with DRF's codes."""

    def __init__(
        self,
        *,
        required: bool | None = None,
        allow_null: bool = False,
        min_length: int | None = None,
        max_length: int | None = None,
        validators: Sequence[Callable[[str], None]] | None = None,
    ) -> None:
        rules: list[Callable[[str], None]] = []

        if min_length is not None:
            rules.append(MinLengthValidator(min_length))

        if max_length is not None:
            rules.append(MaxLengthValidator(max_length))

        super().__init__(str, required=required, allow_null=allow_null, validators=[*rules, *(validators or [])])
