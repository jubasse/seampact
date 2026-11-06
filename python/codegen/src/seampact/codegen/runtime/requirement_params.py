"""The params a decide request carries: the use site's values as the right's or rule's generated params class, a
Pydantic model validated in strict mode, or a frozen dataclass built from the values checked against the params schema
(types, enum values, refinements, item counts, required and unknown members); None for a right or rule that declares
no params. Values the class does not hold fail the boundary before the decider runs."""

import copy
import dataclasses
from typing import Final, Protocol, runtime_checkable

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.hinted_values import built_dataclass
from seampact.codegen.runtime.ir_view import IrMap, ir_int, ir_map, ir_maps, ir_string, ir_strings, ir_true
from seampact.codegen.runtime.value_rules import TYPE_RULE, ValueRuleError, check_length, checked_scalar
from seampact.codegen.runtime.wire_codec import WireCodec
from seampact.hooks import RequirementKind

_DECLARATIONS: Final = {RequirementKind.RIGHT: "rights", RequirementKind.RULE: "rules"}
_OBJECT_SCHEMA: Final = "object"
_UNKNOWN_KEYS_RULE: Final = "unknownKeys"
_REGENERATE: Final = "regenerate the api."
# An array's item counts, checked as lengths: each length rule names its item rule.
_ITEM_RULES: Final = {"minLength": "minItems", "maxLength": "maxItems"}


@runtime_checkable
class _ValidatingModel(Protocol):
    """A generated Pydantic model, read without importing Pydantic, which the DRF target does not install."""

    @classmethod
    def model_validate(cls, obj: object, /, *, strict: bool | None = None) -> object: ...


def requirement_params(contract: ApiContract, kind: RequirementKind, name: str, use_site: IrMap) -> object | None:
    """`use_site` is the requirement or the field right of the IR. Raises `BoundaryFailureError` for params the right or
    rule does not declare, a params schema the contract has no generated class for, or values its class refuses."""
    schema_id = ir_string(contract.declaration(_DECLARATIONS[kind], name), "params")
    values = copy.deepcopy(dict(ir_map(use_site, "params")))

    if schema_id is None and values:
        raise BoundaryFailureError(
            f"seampact: a use of '{name}' in the api '{contract.api}' gives params '{name}' does not declare; "
            f"{_REGENERATE}"
        )

    if schema_id is None:
        return None

    model = contract.params_models.get(schema_id)

    if model is None:
        raise BoundaryFailureError(
            f"seampact: the api '{contract.api}' has no generated class for the params '{schema_id}' of '{name}'; "
            f"{_REGENERATE}"
        )

    try:
        return _params_instance(contract, name, schema_id, model, values)
    except (ValueError, TypeError) as refused:
        raise BoundaryFailureError(
            f"seampact: the params of '{name}' in the api '{contract.api}' do not match '{schema_id}' ({refused}); "
            f"{_REGENERATE}"
        ) from refused


def _params_instance(
    contract: ApiContract, name: str, schema_id: str, model: type, values: dict[str, object]
) -> object:
    if dataclasses.is_dataclass(model):
        return built_dataclass(model, _ParamsCheck(contract).object_tree(schema_id, values, ""))

    if not isinstance(model, _ValidatingModel):
        raise BoundaryFailureError(
            f"seampact: the params class '{model.__qualname__}' of '{name}' is neither a Pydantic model nor a "
            f"dataclass; {_REGENERATE}"
        )

    tree = WireCodec(contract).to_python({"kind": "ref", "schema": schema_id}, values)

    if tree.unknown_keys:
        raise ValueRuleError(_UNKNOWN_KEYS_RULE, f"the members {', '.join(tree.unknown_keys)} are not declared")

    return model.model_validate(tree.value, strict=True)


class _ParamsCheck:
    """The params values checked against their schema and renamed to Python attributes, scalars converted; each
    refusal raises `ValueRuleError` naming its pointer."""

    def __init__(self, contract: ApiContract) -> None:
        self._contract = contract

    def object_tree(self, schema_id: str, value: object, pointer: str) -> dict[str, object]:
        schema = self._contract.declaration("schemas", schema_id)

        if ir_string(schema, "kind") != _OBJECT_SCHEMA:
            raise ValueRuleError("kind", f"'{schema_id}' at '{pointer}' is not an object schema, which params hold")

        if not isinstance(value, dict):
            raise ValueRuleError(TYPE_RULE, f"'{pointer}' is not an object")

        attributes = self._contract.members.get(schema_id, {})
        properties = {ir_string(member, "name") or "": member for member in ir_maps(schema, "properties")}
        unknown = [f"{pointer}/{key}" for key in value if key not in properties or key not in attributes]

        if unknown:
            raise ValueRuleError(_UNKNOWN_KEYS_RULE, f"the members {', '.join(unknown)} are not declared")

        renamed: dict[str, object] = {}

        for member_name, member in properties.items():
            member_pointer = f"{pointer}/{member_name}"

            if member_name not in value:
                if not ir_true(member, "optional"):
                    raise ValueRuleError("required", f"'{member_pointer}' is missing")
                continue

            renamed[attributes[member_name]] = self._member(member, value[member_name], member_pointer)

        return renamed

    def _member(self, member: IrMap, value: object, pointer: str) -> object:
        if value is None and not ir_true(member, "nullable"):
            raise ValueRuleError(TYPE_RULE, f"'{pointer}' is null")

        return None if value is None else self._typed(ir_map(member, "type"), value, pointer)

    def _typed(self, type_use: IrMap, value: object, pointer: str) -> object:
        kind = ir_string(type_use, "kind")

        if kind == "ref":
            return self.object_tree(ir_string(type_use, "schema") or "", value, pointer)

        if kind == "array":
            return self._array(type_use, value, pointer)

        if kind == "enum":
            return self._enum_value(type_use, value, pointer)

        if kind == "opaque":
            return value

        try:
            return checked_scalar(type_use, value)
        except ValueRuleError as refused:
            raise ValueRuleError(refused.rule, f"'{pointer}' breaks '{refused.rule}'") from refused

    def _array(self, type_use: IrMap, value: object, pointer: str) -> list[object]:
        if not isinstance(value, list):
            raise ValueRuleError(TYPE_RULE, f"'{pointer}' is not an array")

        try:
            check_length(value, ir_int(type_use, "minItems"), ir_int(type_use, "maxItems"))
        except ValueRuleError as refused:
            rule = _ITEM_RULES[refused.rule]
            raise ValueRuleError(rule, f"'{pointer}' breaks '{rule}'") from refused

        items = ir_map(type_use, "items")

        return [self._typed(items, item, f"{pointer}/{index}") for index, item in enumerate(value)]

    def _enum_value(self, type_use: IrMap, value: object, pointer: str) -> str:
        enum = self._contract.declaration("enums", ir_string(type_use, "enum") or "")
        allowed = ir_strings(ir_map(type_use, "narrowedTo"), "values") or ir_strings(enum, "values")

        if not isinstance(value, str) or value not in allowed:
            raise ValueRuleError("enum", f"'{pointer}' is not one of {', '.join(allowed)}")

        return value
