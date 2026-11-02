"""The base of the generated serializers and the typed field (ADR 0027 "Types and validation"). A generated
serializer builds its fields in `get_fields()`, never as class attributes, so a contract member named `data`,
`errors` or `fields` never shadows the serializer's own attribute. The generated type layer runs first and converts
date-times, dates, UUIDs, decimals and enum members, so their field only checks the converted type and keeps the
value as it is, with the offset a date-time was sent with."""

from collections.abc import Callable, Sequence
from typing import Any, Final

from rest_framework import serializers

# DRF's stubs type a serializer's fields with `Any`; the generated `get_fields()` returns this.
type SerializerFields = dict[str, serializers.Field[Any, Any, Any, Any]]

_WRONG_TYPE: Final = "type"


class ContractSerializer(serializers.Serializer[object]):
    """Validates the decoded tree of one input part or object schema; it never saves or renders an instance."""


class TypedValueField[V](serializers.Field[V, object, V, object]):
    """Keeps a value of `value_type` as the type layer gave it; anything else is refused with the rule `type`."""

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
        if isinstance(data, self.value_type):
            return data

        raise serializers.ValidationError("Not a value of the contract's type.", code=_WRONG_TYPE)

    def to_representation(self, value: V) -> V:
        return value
