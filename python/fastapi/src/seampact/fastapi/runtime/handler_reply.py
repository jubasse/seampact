"""The reply of a handler's result or of a raised contract exception (ADR 0026 "The reply path"): a declared success
written in its format's envelope with the boundary's own JSON encoding, or a declared error code with its params in
wire names. A result the operation does not declare is a failure of the boundary, answered with the api's 500."""

from dataclasses import dataclass

from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.ir_view import ir_maps, ir_string
from seampact.codegen.runtime.replies import CONTENT_TYPE, JSON_MEDIA, Reply, error_reply, json_bytes, success_body
from seampact.codegen.runtime.wire_codec import WireCodec


@dataclass(frozen=True, slots=True, kw_only=True)
class OperationTypes:
    """The generated types of one operation the runtime builds and reads: its request, its success classes by status
    and its errors class."""

    request: type
    responses: tuple[tuple[int, type], ...]
    errors: type


def result_reply(contract: ApiContract, operation_id: str, types: OperationTypes, result: object, path: str) -> Reply:
    if isinstance(result, types.errors):
        return code_reply(contract, operation_id, getattr(result, "_code", ""), getattr(result, "_params", None))

    status = next((status for status, success in types.responses if isinstance(result, success)), None)

    if status is None:
        raise BoundaryFailureError(
            f"seampact: the handler of operation '{operation_id}' returned a {type(result).__qualname__}, which is "
            "none of the operation's generated results; return one of them."
        )

    response = next(
        (
            declared
            for declared in ir_maps(contract.operation(operation_id), "responses")
            if declared.get("status") == status
        ),
        None,
    )

    if response is None or not hasattr(result, "body"):
        return Reply(status, (), b"")

    payload = WireCodec(contract).body_to_wire(response, result.body)
    body = success_body(contract.format(operation_id), ir_string(response, "shape") or "item", payload, status, path)
    headers = ((CONTENT_TYPE, ir_string(response, "media") or JSON_MEDIA),)

    return Reply(status, headers, json_bytes(body))


def code_reply(contract: ApiContract, operation_id: str, code: str, params: object) -> Reply:
    """A declared code of the operation, its params model written in wire names."""
    if not contract.declares(operation_id, code):
        raise BoundaryFailureError(
            f"seampact: operation '{operation_id}' answered '{code}', which it does not declare; answer one of its "
            "declared codes."
        )

    params_schema = contract.catalog_entry(code).get("params")
    wire_params: object = None

    if params is not None and isinstance(params_schema, str):
        wire_params = WireCodec(contract).to_wire({"kind": "ref", "schema": params_schema}, params)

    return error_reply(contract, operation_id, code, wire_params if isinstance(wire_params, dict) else None)
