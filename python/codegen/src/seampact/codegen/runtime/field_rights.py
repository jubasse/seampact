"""Field rights (ADR 0012 section 6, Restricted fields): step 7 refuses a restricted top-level input member sent without its right,
or leaves it out under `inputPolicy: strip`; before a success is written, each restricted output member whose right
the decider denies for its holder is left out, one decision per right, use-site params, pointer and subject, and a
member the contract never sends on the operation (`always: absent`) is left out without a decision. Each returns a
copy; the tree it reads is never changed."""

import copy
import json
from collections.abc import Mapping
from typing import Final

from seampact.codegen.runtime.access_steps import (
    AccessHooks,
    AccessState,
    HookCaller,
    decided,
    extensions_of,
    refusal_of,
    subject_of,
    subject_type,
)
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.ir_view import IrMap, ir_map, ir_maps, ir_string
from seampact.codegen.runtime.replies import role_params
from seampact.codegen.runtime.requirement_params import requirement_params
from seampact.hooks import FieldDirection, RequirementKind, RequirementRequest, SubjectRef, decision, purpose

_INPUT: Final = "input"
_OUTPUT: Final = "output"
_STRIP: Final = "strip"
_ABSENT: Final = "absent"
_FORBIDDEN_ROLE: Final = "forbidden"
_HOLDER_FIELD: Final = "holderField"
_WILDCARD: Final = "*"
_TABLE_SHAPE: Final = "table"
_ITEMS_SHAPES: Final = frozenset({"list", "page"})


async def checked_input_fields(state: AccessState, hooks: AccessHooks, call: HookCaller) -> object:
    """The decoded body with each restricted member the decider denies left out under `strip`.

    Raises `ContractRefusal` with the denial's code, its params joined by the `forbidden` role's `pointer`, for a
    denied member under `reject`."""
    if not isinstance(state.body, Mapping):
        return state.body

    body = copy.deepcopy(dict(state.body))

    for field_right in ir_maps(state.contract.operation(state.operation_id), "fieldRights"):
        if ir_string(field_right, "direction") != _INPUT:
            continue

        pointer = ir_string(field_right, "pointer") or ""
        member = "/".join(_pointer_segments(pointer))

        if member not in body:
            continue

        right = ir_string(field_right, "right") or ""
        subject = subject_of(state, ir_map(field_right, "subject"), right)
        answer = await decided(hooks, call, _request(state, field_right, subject, FieldDirection.INPUT))

        if isinstance(answer, decision.Allowed):
            continue

        if ir_string(field_right, "inputPolicy") == _STRIP:
            del body[member]
            continue

        raise _forbidden_field(state, answer, pointer)

    return body


async def visible_output(
    state: AccessState, hooks: AccessHooks, call: HookCaller, response: IrMap, wire_body: object
) -> object:
    """The success body as the wire writes it, without each restricted member its holder may not see."""
    body = copy.deepcopy(wire_body)
    decisions: dict[tuple[str, str, str, str], bool] = {}
    body_schema = ir_string(ir_map(response, "body"), "schema")

    for field_right in ir_maps(state.contract.operation(state.operation_id), "fieldRights"):
        if ir_string(field_right, "direction") != _OUTPUT or ir_string(field_right, "schema") != body_schema:
            continue

        segments = _pointer_segments(ir_string(field_right, "pointer") or "")
        member = segments.pop()

        for instance in _instances(body, ir_string(response, "shape")):
            for holder in _holders(instance, segments):
                if member in holder and not await _allowed(state, hooks, call, field_right, holder, decisions):
                    del holder[member]

    return body


async def _allowed(
    state: AccessState,
    hooks: AccessHooks,
    call: HookCaller,
    field_right: IrMap,
    holder: Mapping[str, object],
    decisions: dict[tuple[str, str, str, str], bool],
) -> bool:
    if ir_string(field_right, "always") == _ABSENT:
        return False

    right = ir_string(field_right, "right") or ""
    source = ir_map(ir_map(field_right, "subject"), "source")
    subject = None

    if ir_string(source, "in") == _HOLDER_FIELD:
        holder_id = holder.get(ir_string(source, "name") or "")

        # A holder without a usable id names no subject: the decider is asked with none.
        if isinstance(holder_id, str | int) and not isinstance(holder_id, bool):
            subject = SubjectRef(type=subject_type(state.contract, right), id=holder_id)
    elif source:
        subject = subject_of(state, ir_map(field_right, "subject"), right)

    # The decider sees the field's params and pointer, so both join the key.
    use_site_params = json.dumps(field_right.get("params"), sort_keys=True)
    pointer = ir_string(field_right, "pointer") or ""
    key = (right, use_site_params, pointer, "" if subject is None else repr(subject.id))

    if key not in decisions:
        answer = await decided(hooks, call, _request(state, field_right, subject, FieldDirection.OUTPUT))
        decisions[key] = isinstance(answer, decision.Allowed)

    return decisions[key]


def _pointer_segments(pointer: str) -> list[str]:
    """The member names a JSON pointer walks, `~1` and `~0` unescaped."""
    return [segment.replace("~1", "/").replace("~0", "~") for segment in pointer[1:].split("/")]


def _instances(body: object, shape: str | None) -> list[object]:
    """A table's values and a list's or page's items are each an instance of the body's schema."""
    if shape == _TABLE_SHAPE:
        return list(body.values()) if isinstance(body, dict) else []

    if shape in _ITEMS_SHAPES:
        return list(body) if isinstance(body, list) else []

    return [body]


def _holders(instance: object, segments: list[str]) -> list[dict[str, object]]:
    """The objects a pointer's parent segments reach, `*` standing for every item of an array."""
    current = [instance]

    for segment in segments:
        reached: list[object] = []

        for node in current:
            if segment == _WILDCARD and isinstance(node, list):
                reached.extend(node)
            elif isinstance(node, dict) and segment in node:
                reached.append(node[segment])

        current = reached

    return [node for node in current if isinstance(node, dict)]


def _request(
    state: AccessState, field_right: IrMap, subject: SubjectRef | None, direction: FieldDirection
) -> RequirementRequest:
    name = ir_string(field_right, "right") or ""
    operation = state.contract.operation(state.operation_id)

    return RequirementRequest(
        kind=RequirementKind.RIGHT,
        name=name,
        params=requirement_params(state.contract, RequirementKind.RIGHT, name, field_right),
        principal=state.principal,
        subject=subject,
        scopes=tuple(state.scopes),
        purpose=purpose.Field(pointer=ir_string(field_right, "pointer") or "", direction=direction),
        operation=state.operation,
        request=state.request,
        extensions=RequirementRequest.Extensions(requirement={}, operation=extensions_of(operation)),
    )


def _forbidden_field(state: AccessState, denied: decision.Denied, pointer: str) -> ContractRefusal:
    refusal = refusal_of(state, denied.deny)
    rendered = role_params(state.contract, state.operation_id, refusal.code, _FORBIDDEN_ROLE, {"pointer": pointer})
    params = {**(refusal.params or {}), **(rendered or {})}

    return ContractRefusal(state.contract.api, refusal.code, params)
