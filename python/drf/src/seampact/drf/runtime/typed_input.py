"""Steps 6 to 8 on DRF (ADR 0027 "Types and validation"): the generated type layer checks every type of the
boundary's decoded parts first and converts what the wire carries as text, so DRF's lax conversions never see a wrong
type; the generated serializer then runs the value rules; each issue keeps its `{ in, pointer, rule }` in wire names,
bounded by `MAX_RENDERED_ISSUES`; the handler gets the input as frozen dataclasses."""

import dataclasses
from collections.abc import Mapping, Sequence
from typing import Final

from rest_framework.exceptions import ErrorDetail

from seampact.codegen.runtime.contract import HEADER_PART, PATH_PART, QUERY_PART, ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.hinted_values import built_dataclass
from seampact.codegen.runtime.input_decoding import DecodedInput, Issue
from seampact.codegen.runtime.ir_view import IrMap, ir_map, ir_maps, ir_string, ir_true
from seampact.codegen.runtime.value_rules import TYPE_RULE, ValueRuleError, scalar_from_wire

MAX_RENDERED_ISSUES: Final = 100

_UNKNOWN_KEYS_RULE: Final = "unknownKeys"
_IGNORE: Final = "ignore"
_KEEP: Final = "keep"
_BODY: Final = "body"
# The serializer's key of each part, and the `in` of its issues.
_PARTS: Final = ((PATH_PART, PATH_PART, "path"), (QUERY_PART, QUERY_PART, "query"), ("headers", HEADER_PART, "header"))
# DRF's error codes and Django's validator codes as the contract names the rule; an array's length rule is its own.
_RULES: Final = {
    "required": "required",
    "null": TYPE_RULE,
    "invalid": TYPE_RULE,
    "not_a_list": TYPE_RULE,
    "min_value": "minimum",
    "max_value": "maximum",
    "min_length": "minLength",
    "max_length": "maxLength",
}
_ITEM_RULES: Final = {"min_length": "minItems", "max_length": "maxItems", "empty": "minItems"}


@dataclasses.dataclass(slots=True)
class TypedParts:
    """The parts as the serializer reads them, keyed by Python attribute, and the type layer's issues."""

    tree: dict[str, object]
    issues: list[Issue]


def typed_parts(contract: ApiContract, operation_id: str, decoded: DecodedInput) -> TypedParts:
    operation = contract.operation(operation_id)
    params = ir_map(operation, "params")
    tree: dict[str, object] = {}
    issues: list[Issue] = []
    values_of = {PATH_PART: decoded.path, QUERY_PART: decoded.query, HEADER_PART: decoded.headers}

    for key, part, issue_in in _PARTS:
        members = contract.part_members(operation_id, part)

        # An undeclared query key is refused even when the operation declares no query parameter.
        if not members and part != QUERY_PART:
            continue

        declared = {ir_string(param, "name") or "": param for param in ir_maps(params, part)}
        part_tree: dict[str, object] = {}

        for name, value in values_of[part].items():
            attribute = members.get(name)

            if attribute is None:
                if part == QUERY_PART and not contract.ignores_unknown_query(operation_id):
                    issues.append(Issue(issue_in, f"/{_escaped(name)}", _UNKNOWN_KEYS_RULE))
                continue

            walker = _TypeWalker(contract, issue_in, _IGNORE)
            part_tree[attribute] = walker.typed(
                ir_map(declared.get(name), "type"), value, _param_pointer(issue_in, name)
            )
            issues += walker.issues

        if members:
            tree[key] = part_tree

    input_use = ir_map(ir_map(operation, "input"), "schema")

    if input_use and decoded.body is not None:
        proofs = set(contract.part_members(operation_id, "proofs"))
        walker = _TypeWalker(contract, _BODY, contract.unknown_keys_policy(operation_id), proofs)
        tree[_BODY] = walker.typed(input_use, decoded.body, "")
        issues += walker.issues

    return TypedParts(tree, issues)


def serializer_issues(contract: ApiContract, operation_id: str, errors: Mapping[str, object]) -> list[Issue]:
    """The serializer's errors as issues in wire names."""
    operation = contract.operation(operation_id)
    params = ir_map(operation, "params")
    issues: list[Issue] = []

    for key, part, issue_in in _PARTS:
        wire_names = {attribute: name for name, attribute in contract.part_members(operation_id, part).items()}
        types = {ir_string(param, "name") or "": ir_map(param, "type") for param in ir_maps(params, part)}
        part_errors = errors.get(key)

        if isinstance(part_errors, Mapping):
            for attribute, found in part_errors.items():
                name = wire_names.get(str(attribute), str(attribute))
                issues += _issues(contract, issue_in, _param_pointer(issue_in, name), types.get(name, {}), found)

    body_errors = errors.get(_BODY)

    if body_errors is not None:
        issues += _issues(contract, _BODY, "", ir_map(ir_map(operation, "input"), "schema"), body_errors)

    return issues


def _param_pointer(issue_in: str, name: str) -> str:
    """A parameter's pointer; a header's is lower case, since header names are not case sensitive."""
    return f"/{_escaped(name.lower() if issue_in == HEADER_PART else name)}"


def rendered(issues: Sequence[Issue]) -> list[Issue]:
    unique: list[Issue] = []

    for issue in issues:
        if issue not in unique:
            unique.append(issue)

    return unique[:MAX_RENDERED_ISSUES]


def built_input[I](input_type: type[I], validated: Mapping[str, object]) -> I:
    """The input dataclass from the serializer's validated data, nested dataclasses built from their hints."""
    built = built_dataclass(input_type, validated)

    if not isinstance(built, input_type):
        raise BoundaryFailureError(f"seampact: the input type {input_type.__qualname__} is not a generated dataclass.")

    return built


def _issues(contract: ApiContract, issue_in: str, pointer: str, type_use: IrMap, found: object) -> list[Issue]:
    if isinstance(found, ErrorDetail):
        rules = _ITEM_RULES if ir_string(type_use, "kind") == "array" else {}
        code = str(found.code)
        return [Issue(issue_in, pointer, rules.get(code) or _RULES.get(code) or code)]

    if isinstance(found, list):
        return [issue for item in found for issue in _issues(contract, issue_in, pointer, type_use, item)]

    if not isinstance(found, Mapping):
        return [Issue(issue_in, pointer, TYPE_RULE)]

    if ir_string(type_use, "kind") == "array":
        items = ir_map(type_use, "items")
        return [
            issue
            for index, item in found.items()
            for issue in _issues(contract, issue_in, f"{pointer}/{index}", items, item)
        ]

    schema_id = ir_string(type_use, "schema") or ""
    wire_names = {attribute: name for name, attribute in contract.members.get(schema_id, {}).items()}
    properties = {
        ir_string(member, "name") or "": member
        for member in ir_maps(contract.declaration("schemas", schema_id), "properties")
    }
    issues: list[Issue] = []

    for attribute, item in found.items():
        name = wire_names.get(str(attribute), str(attribute))
        issues += _issues(contract, issue_in, f"{pointer}/{_escaped(name)}", ir_map(properties.get(name), "type"), item)

    return issues


class _TypeWalker:
    """Checks a decoded tree against its type use, renames object members to their Python attributes, converts
    scalars, and collects the issues; an unknown object member follows the input use's policy."""

    def __init__(
        self, contract: ApiContract, issue_in: str, unknown_keys: str, declared_keys: set[str] | None = None
    ) -> None:
        if unknown_keys == _KEEP:
            raise BoundaryFailureError(
                "seampact: an input that keeps unknown keys is not served by this release of seampact-drf; set its "
                "unknownKeys to 'refuse' or 'ignore'."
            )

        self.contract = contract
        self.issue_in = issue_in
        self.unknown_keys = unknown_keys
        self.declared_keys = declared_keys or set()
        self.issues: list[Issue] = []

    def typed(self, type_use: IrMap, value: object, pointer: str) -> object:
        kind = ir_string(type_use, "kind")

        if kind == "ref":
            return self._object(ir_string(type_use, "schema") or "", value, pointer)

        if kind == "array":
            if not isinstance(value, list):
                return self._issue(pointer, TYPE_RULE, value)

            return [
                self.typed(ir_map(type_use, "items"), item, f"{pointer}/{index}") for index, item in enumerate(value)
            ]

        if isinstance(value, list) and kind != "opaque":
            return self._issue(pointer, TYPE_RULE, value)

        try:
            return scalar_from_wire(type_use, value)
        except ValueRuleError as refused:
            return self._issue(pointer, refused.rule, value)

    def _object(self, schema_id: str, value: object, pointer: str) -> object:
        if not isinstance(value, dict):
            return self._issue(pointer, TYPE_RULE, value)

        attributes = self.contract.members.get(schema_id, {})
        schema = self.contract.declaration("schemas", schema_id)
        properties = {ir_string(member, "name") or "": member for member in ir_maps(schema, "properties")}
        renamed: dict[str, object] = {}

        for name, member_value in value.items():
            member_pointer = f"{pointer}/{_escaped(name)}"
            attribute = attributes.get(name)

            if attribute is None:
                if self.unknown_keys != _IGNORE and not (pointer == "" and name in self.declared_keys):
                    self.issues.append(Issue(self.issue_in, member_pointer, _UNKNOWN_KEYS_RULE))
                continue

            member = properties[name]

            if member_value is None:
                if not ir_true(member, "nullable"):
                    self._issue(member_pointer, TYPE_RULE, None)
                renamed[attribute] = None
                continue

            renamed[attribute] = self.typed(ir_map(member, "type"), member_value, member_pointer)

        return renamed

    def _issue(self, pointer: str, rule: str, value: object) -> object:
        self.issues.append(Issue(self.issue_in, pointer, rule))

        return value


def _escaped(name: str) -> str:
    return name.replace("~", "~0").replace("/", "~1")
