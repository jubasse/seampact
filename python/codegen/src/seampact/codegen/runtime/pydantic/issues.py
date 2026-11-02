"""Step 6's issues from a Pydantic `ValidationError`: each error's location read back to the wire's JSON pointer through
the api's member tables, and its type to the contract rule name (ADR 0026 "Types and validation"), bounded by
`MAX_RENDERED_ISSUES`. FastAPI and Ninja share it."""

from collections.abc import Mapping, Sequence
from typing import Final

from pydantic import ValidationError

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.input_decoding import Issue
from seampact.codegen.runtime.ir_view import IrMap, ir_map, ir_string

MAX_RENDERED_ISSUES: Final = 100

_CONTRACT_RULES: Final = frozenset(
    {
        "required",
        "type",
        "format",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "pattern",
        "enum",
        "const",
        "unknownKeys",
    }
)
_PYDANTIC_RULES: Final = {
    "missing": "required",
    "string_too_short": "minLength",
    "string_too_long": "maxLength",
    "too_short": "minItems",
    "too_long": "maxItems",
    "greater_than_equal": "minimum",
    "greater_than": "exclusiveMinimum",
    "less_than_equal": "maximum",
    "less_than": "exclusiveMaximum",
    "multiple_of": "multipleOf",
    "string_pattern_mismatch": "pattern",
    "enum": "enum",
    "literal_error": "enum",
    "extra_forbidden": "unknownKeys",
}
_TYPE_RULE: Final = "type"


def part_issues(in_: str, members: Mapping[str, str], error: ValidationError) -> list[Issue]:
    """The issues of a path, query or header model, whose members `members` maps from wire name to attribute."""
    wire_names = {attribute: wire_name for wire_name, attribute in members.items()}
    issues: list[Issue] = []

    for detail in error.errors():
        location = detail["loc"]
        first = str(location[0]) if location else ""
        rest = "".join(f"/{_escaped(str(step))}" for step in location[1:])
        issues.append(Issue(in_, f"/{_escaped(wire_names.get(first, first))}{rest}", contract_rule(detail["type"])))

    return issues[:MAX_RENDERED_ISSUES]


def body_issues(contract: ApiContract, type_use: IrMap, error: ValidationError) -> list[Issue]:
    """The issues of a body validated as `type_use`, their pointers in wire names."""
    return [
        Issue("body", body_pointer(contract, type_use, detail["loc"]), contract_rule(detail["type"]))
        for detail in error.errors()
    ][:MAX_RENDERED_ISSUES]


def proof_issues(
    contract: ApiContract, proofs: Mapping[str, IrMap], members: Mapping[str, str], error: ValidationError
) -> list[Issue]:
    """The issues of a body's rule proofs validated as one model: `proofs` holds each proof's type use by wire name,
    `members` maps each wire name to its attribute; a pointer starts at the proof's body member."""
    wire_names = {attribute: wire_name for wire_name, attribute in members.items()}
    issues: list[Issue] = []

    for detail in error.errors():
        location = detail["loc"]
        attribute = str(location[0]) if location else ""
        wire_name = wire_names.get(attribute, attribute)
        inner = body_pointer(contract, proofs.get(wire_name, {}), location[1:])
        issues.append(Issue("body", f"/{_escaped(wire_name)}{inner}", contract_rule(detail["type"])))

    return issues[:MAX_RENDERED_ISSUES]


def contract_rule(error_type: str) -> str:
    """The contract rule a Pydantic error type stands for; the type layer's own errors are named after their rule."""
    if error_type in _CONTRACT_RULES:
        return error_type

    return _PYDANTIC_RULES.get(error_type, _TYPE_RULE)


def body_pointer(contract: ApiContract, type_use: IrMap, location: Sequence[int | str]) -> str:
    """The JSON pointer of a Pydantic location in a body of `type_use`, attributes read back to wire names."""
    pointer = ""
    current = type_use

    for step in location:
        kind = ir_string(current, "kind")

        if kind == "ref" and isinstance(step, str):
            schema_id = ir_string(current, "schema") or ""
            wire_names = {attribute: wire for wire, attribute in contract.members.get(schema_id, {}).items()}
            wire_name = wire_names.get(step, step)
            pointer += f"/{_escaped(wire_name)}"
            current = _member_type(contract, schema_id, wire_name)
            continue

        if kind == "array":
            current = ir_map(current, "items")

        pointer += f"/{_escaped(str(step))}"

    return pointer


def _member_type(contract: ApiContract, schema_id: str, wire_name: str) -> IrMap:
    schema = contract.declaration("schemas", schema_id)
    properties = schema.get("properties")

    for member in properties if isinstance(properties, list) else []:
        if isinstance(member, Mapping) and ir_string(member, "name") == wire_name:
            return ir_map(member, "type")

    return {}


def _escaped(name: str) -> str:
    return name.replace("~", "~0").replace("/", "~1")
