"""The `contract` module of an api's package, the same on every Python target (ADR 0026 "Placement", ADR 0027): the
`ApiContract` the runtime reads per operation. It holds the IR of the kept operations whole (security and access,
idempotency, paging, relay, cache, the unknown-key and unknown-query policies, the body's rule proofs) and the
declarations they read, then the Python attribute of each member's wire name: per object schema, and per operation for
its path, query and header parameters and its body's rule proofs."""

from collections.abc import Mapping, Sequence
from typing import Final

from seampact.codegen.kept_forms import handler_headers
from seampact.codegen.names import ApiNames, member_identifier, part_attributes
from seampact.codegen.printer import INDENT, PythonModule, literal_lines
from seampact.codegen.refusals import IrPlace, Refusals
from seampact.codegen.runtime.contract import HEADER_PART, PATH_PART, PROOFS_PART, QUERY_PART
from seampact.codegen.runtime.version import RUNTIME_VERSION
from seampact.ir.model import ContractIR, Operation, Param

# The IR members the runtime reads beside the operations; the others stay out of the module.
IR_VIEW_MEMBERS: Final = (
    "api",
    "errors",
    "formats",
    "identities",
    "schemes",
    "scopes",
    "rights",
    "rules",
    "buckets",
    "pagings",
    "schemas",
    "enums",
)
CONTRACT_NAME: Final = "CONTRACT"


def contract_module(ir: ContractIR, names: ApiNames, mount: str, refusals: Refusals) -> str:
    """`names` may hold more schemas than `ir` (a target's own input models): only the IR's schemas are written."""
    module = PythonModule(f"The contract of api '{ir.api.id}' as its boundary reads it.")
    typing = module.imported("typing", "_typing")
    runtime = module.imported("seampact.codegen.runtime.contract", "_contract")
    arguments: list[tuple[str, object]] = [
        ("api", ir.api.id),
        ("generated_by", RUNTIME_VERSION),
        ("mount", mount),
        ("ir_view", ir_view(ir)),
        ("members", {schema_id: names.members[schema_id] for schema_id in ir.schemas if schema_id in names.members}),
        ("operation_members", _operation_members(ir, refusals)),
    ]
    lines = [f"{CONTRACT_NAME}: {typing}.Final = {runtime}.ApiContract("]

    for name, value in arguments:
        lines += literal_lines(INDENT, f"{name}=", value, ",")

    module.add_block([*lines, ")"])

    return module.text()


def ir_view(ir: ContractIR) -> dict[str, object]:
    """The IR members the runtime reads, as the IR's JSON writes them."""
    document = ir.to_json()
    view: dict[str, object] = {member: document.get(member, {}) for member in IR_VIEW_MEMBERS}
    view["operations"] = document["operations"]

    return view


def _operation_members(ir: ContractIR, refusals: Refusals) -> dict[str, dict[str, Mapping[str, str]]]:
    members: dict[str, dict[str, Mapping[str, str]]] = {}

    for index, operation in enumerate(ir.operations):
        at = IrPlace(f"/operations/{index}", operation.id)
        parts = {
            PATH_PART: _part(operation.params.path, at.below("params", "path"), refusals),
            QUERY_PART: _part(operation.params.query, at.below("params", "query"), refusals),
            HEADER_PART: _part(handler_headers(operation), at.below("params", "header"), refusals),
            PROOFS_PART: _proofs(operation, at.below("input", "proofs"), refusals),
        }
        members[operation.id] = {part: attributes for part, attributes in parts.items() if attributes}

    return members


def _part(params: Sequence[Param], at: IrPlace, refusals: Refusals) -> dict[str, str]:
    return {param.name: attribute for _, param, attribute in part_attributes(params, at, refusals)}


def _proofs(operation: Operation, at: IrPlace, refusals: Refusals) -> dict[str, str]:
    proofs = operation.input.proofs if operation.input is not None else None
    attributes: dict[str, str] = {}

    for index, proof in enumerate(proofs or ()):
        attribute = member_identifier(proof.name)

        if attribute is None:
            refusals.inconsistent("name.segment.missing", f"The body proof '{proof.name}' has no name segment", at)
            continue

        if attribute in attributes.values():
            refusals.add(
                "name.collision",
                f"Two body proofs of operation '{operation.id}' give the Python name '{attribute}'.",
                "Rename one of the proofs in the contract.",
                at.below(index),
            )

        attributes[proof.name] = attribute

    return attributes
