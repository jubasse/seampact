"""The reply of a handler's result or of a raised contract exception (ADR 0026 "The reply path"): a declared success
written in its format's envelope with the boundary's own JSON encoding, less the restricted output members the caller
may not see, with its page parts and cache headers; or a declared error code with its params in wire names. A result
the operation does not declare is a failure of the boundary, answered with the api's 500."""

import dataclasses
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from seampact.codegen.runtime.access_steps import AccessHooks, AccessState, HookCaller
from seampact.codegen.runtime.cache_headers import with_cache_headers
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError
from seampact.codegen.runtime.field_rights import visible_output
from seampact.codegen.runtime.ir_view import IrMap, ir_maps, ir_string
from seampact.codegen.runtime.page_facts import page_facts
from seampact.codegen.runtime.page_reply import PageParts, page_parts
from seampact.codegen.runtime.replies import CONTENT_TYPE, JSON_MEDIA, Reply, error_reply, json_bytes, success_body
from seampact.codegen.runtime.run_settings import OperationTypes
from seampact.codegen.runtime.wire_codec import WireCodec

_ITEM_SHAPE: Final = "item"
_PAGE_SHAPE: Final = "page"
_ITEMS: Final = "items"


@dataclass(frozen=True, slots=True, kw_only=True)
class ReplyContext:
    """What a success reads of its request: the access steps' state and hooks (the output field rights ask the
    deciders, through `call`), the query the input step read and the raw one page links keep, the request path,
    `If-None-Match`, and the origin absolute page links start with (None under relative URLs)."""

    access: AccessState
    hooks: AccessHooks
    call: HookCaller
    query: Mapping[str, object]
    raw_query: str
    path: str
    if_none_match: str | None
    public_origin: str | None


async def result_reply(
    contract: ApiContract, operation_id: str, types: OperationTypes, result: object, context: ReplyContext
) -> Reply:
    """A declared error, or a success with its restricted output members left out, its page parts and its cache
    headers (the ETag's 304 when `If-None-Match` names it)."""
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

    shape = ir_string(response, "shape") or _ITEM_SHAPE
    media_headers = ((CONTENT_TYPE, ir_string(response, "media") or JSON_MEDIA),)

    if shape == _PAGE_SHAPE:
        page = await _page(contract, operation_id, response, result.body, status, context)
        reply = Reply(status, (*media_headers, *page.headers), json_bytes(page.body))
    else:
        payload = WireCodec(contract).body_to_wire(response, result.body)
        visible = await visible_output(context.access, context.hooks, context.call, response, payload)
        body = success_body(contract.format(operation_id), shape, visible, status, context.path)
        reply = Reply(status, media_headers, json_bytes(body))

    return with_cache_headers(contract, operation_id, reply, context.access.principal, context.if_none_match)


async def _page(
    contract: ApiContract, operation_id: str, response: IrMap, page: object, status: int, context: ReplyContext
) -> PageParts:
    """The page's items encoded and projected, then the body, headers and links of its paging style."""
    if not dataclasses.is_dataclass(page) or isinstance(page, type):
        raise BoundaryFailureError(
            f"seampact: the handler of operation '{operation_id}' answered its page with a {type(page).__qualname__}, "
            "not its generated page class; return the generated page."
        )

    attributes = {field.name: getattr(page, field.name) for field in dataclasses.fields(page)}
    facts = page_facts(operation_id, page, attributes)
    items = WireCodec(contract).body_to_wire(response, facts.pop(_ITEMS, []))
    visible = await visible_output(context.access, context.hooks, context.call, response, items)

    if not isinstance(visible, list):
        raise BoundaryFailureError(
            f"seampact: the items of operation '{operation_id}' encoded to a {type(visible).__qualname__}, not a "
            "list; return the page's items as a list."
        )

    return page_parts(
        contract,
        operation_id,
        context.query,
        context.raw_query,
        visible,
        facts,
        status,
        context.path,
        public_origin=context.public_origin,
    )


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
