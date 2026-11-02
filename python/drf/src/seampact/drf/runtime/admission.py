"""What a generated DRF view does once DRF's `initial()` ran (ADR 0027 "DRF"): it checks the boundary's mark and
the chosen route, runs steps 2 to 5, then reads the input (the version a header carries before the header check,
steps 6 to 8, the restricted input fields, the deadline and the idempotency claim) and writes the handler's result
with the boundary's own encoding: the restricted output fields left out, the page body and links, absolute from the
api's `public_origin` under absolute URLs, and the cache headers with their 304."""

import dataclasses
import inspect
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Final

from django.http import HttpRequest, HttpResponseBase

from seampact.codegen.names import member_identifier
from seampact.codegen.runtime.access_steps import (
    AccessHooks,
    AccessState,
    CredentialsType,
    headers_view,
    run_access_steps,
)
from seampact.codegen.runtime.cache_headers import with_cache_headers
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.deadline import request_deadline
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.field_rights import checked_input_fields, visible_output
from seampact.codegen.runtime.input_decoding import DecodedInput, schema_invalid
from seampact.codegen.runtime.ir_view import ir_int, ir_map, ir_maps, ir_string, ir_strings
from seampact.codegen.runtime.page_reply import filled_page_query, page_parts
from seampact.codegen.runtime.public_origin import configured_origin
from seampact.codegen.runtime.replies import CONTENT_TYPE, JSON_MEDIA, Reply, error_reply, json_bytes, success_body
from seampact.codegen.runtime.sync_driver import call_without_suspension, run_without_suspension
from seampact.codegen.runtime.version_token import sent_version
from seampact.codegen.runtime.wire_codec import WireCodec
from seampact.django.runtime.api_configuration import configuration_of
from seampact.django.runtime.contract_replies import django_response
from seampact.django.runtime.idempotency_records import claim_idempotency
from seampact.django.runtime.request_state import BoundaryState, state_of
from seampact.drf.runtime.serializers import ContractSerializer
from seampact.drf.runtime.typed_input import built_input, rendered, serializer_issues, typed_parts
from seampact.hooks import RequestView, ResolvedScope

_EMPTY_SHAPE: Final = "empty"
_PAGE_SHAPE: Final = "page"
_IF_NONE_MATCH: Final = "If-None-Match"
_QUERY_STRING: Final = "QUERY_STRING"


class ContractAdmission:
    """A request the view admitted, and what it reads next."""

    def __init__(self, request: HttpRequest, state: BoundaryState, admitted: AccessState, hooks: AccessHooks) -> None:
        self._request = request
        self._state = state
        self._admitted = admitted
        self._hooks = hooks
        self._query: Mapping[str, object] = state.decoded.query

    def input[I](self, serializer: type[ContractSerializer], input_type: type[I]) -> I:
        decoded = self._checked_version()
        validated = self._validated(serializer, decoded)
        handed = self._with_page_limit(decoded)
        restricted_body = self._restricted_input(handed)

        if handed is not decoded or restricted_body != decoded.body:
            validated = self._validated(serializer, dataclasses.replace(handed, body=restricted_body))

        claim_idempotency(self._request, self._state, self._admitted.principal)

        return built_input(input_type, validated)

    def empty_input[I](self, input_type: type[I]) -> I:
        contract, operation_id = self._state.contract, self._state.operation_id
        decoded = self._checked_version()
        issues = typed_parts(contract, operation_id, decoded).issues

        if issues:
            raise schema_invalid(contract, operation_id, rendered(issues))

        self._restricted_input(decoded)
        claim_idempotency(self._request, self._state, self._admitted.principal)

        return input_type()

    def principal[P](self, principal_type: type[P]) -> P:
        principal = self.optional_principal(principal_type)

        if principal is None:
            raise BoundaryFailureError(
                f"seampact: operation '{self._state.operation_id}' has no principal; its authenticate hook must "
                f"answer Authenticated with a {principal_type.__qualname__}."
            )

        return principal

    def optional_principal[P](self, principal_type: type[P]) -> P | None:
        principal = self._admitted.principal

        if principal is None or isinstance(principal, principal_type):
            return principal

        raise BoundaryFailureError(
            f"seampact: the authenticate hook of operation '{self._state.operation_id}' answered a "
            f"{type(principal).__qualname__}; answer Authenticated with a {principal_type.__qualname__}."
        )

    def scope(self, scope: str) -> ResolvedScope:
        found = next((resolved for resolved in self._admitted.scopes if resolved.scope == scope), None)

        if found is None:
            raise BoundaryFailureError(f"seampact: operation '{self._state.operation_id}' resolved no scope '{scope}'.")

        return found

    def reply(self, result: object) -> HttpResponseBase:
        """The handler's result, or its declared error, written by the boundary's own encoding."""
        contract, operation_id = self._state.contract, self._state.operation_id

        if inspect.iscoroutine(result):
            result.close()
            raise BoundaryFailureError(
                f"seampact: the handler of '{operation_id}' is an async def; DRF views are sync, so write it as a "
                "plain def."
            )

        status = getattr(type(result), "status", None)

        if isinstance(status, int):
            reply = self._success(status, result)
        else:
            reply = declared_error_reply(contract, operation_id, result)

        return django_response(self._request, contract, reply)

    def _checked_version(self) -> DecodedInput:
        """The decoded input, after the version check of an operation that reads its version from a header, so a
        missing header is `preconditionRequired`, never `schemaInvalid`."""
        contract, operation_id, decoded = self._state.contract, self._state.operation_id, self._state.decoded

        if ir_map(contract.operation(operation_id), "concurrency"):
            sent_version(contract, operation_id, decoded)

        return decoded

    def _with_page_limit(self, decoded: DecodedInput) -> DecodedInput:
        """The validated input with the page limit the handler receives: the default for none sent, `maxLimit` for a
        larger one under `clamp`; the input itself when the operation is no paged list."""
        contract, operation_id = self._state.contract, self._state.operation_id

        if not ir_map(contract.operation(operation_id), "paging"):
            return decoded

        self._query = filled_page_query(contract, operation_id, decoded.query)

        return dataclasses.replace(decoded, query=dict(self._query))

    def _validated(self, serializer: type[ContractSerializer], decoded: DecodedInput) -> Mapping[str, object]:
        """Step 6: the type layer, then the serializer's value rules, every issue at once."""
        contract, operation_id = self._state.contract, self._state.operation_id
        parts = typed_parts(contract, operation_id, decoded)
        validating = serializer(data=parts.tree)
        valid = validating.is_valid()
        # A value the type layer refused is reported once, by the type layer.
        typed = {(issue.in_, issue.pointer) for issue in parts.issues}
        rules = [] if valid else serializer_issues(contract, operation_id, validating.errors)
        issues = parts.issues + [issue for issue in rules if (issue.in_, issue.pointer) not in typed]

        if issues:
            raise schema_invalid(contract, operation_id, rendered(issues))

        validated = validating.validated_data

        if not isinstance(validated, Mapping):
            raise BoundaryFailureError(f"seampact: the serializer of '{operation_id}' validated no mapping.")

        return validated

    def _restricted_input(self, decoded: DecodedInput) -> object:
        """Step 7, the body without the restricted members its caller may not send under `strip` (a denied member
        under `reject` is refused), then the deadline the caller sent, in ADR 0026's order."""
        restricted_body = run_without_suspension(
            checked_input_fields(self._admitted, self._hooks, call_without_suspension)
        )
        request_deadline(self._state.contract, self._state.operation_id, decoded, datetime.now(UTC))

        return restricted_body

    def _success(self, status: int, result: object) -> Reply:
        contract, operation_id = self._state.contract, self._state.operation_id
        operation = contract.operation(operation_id)
        response = next((item for item in ir_maps(operation, "responses") if ir_int(item, "status") == status), None)

        if response is None:
            raise BoundaryFailureError(f"seampact: operation '{operation_id}' declares no {status} reply.")

        shape = ir_string(response, "shape") or ""

        if shape == _EMPTY_SHAPE:
            return Reply(status, (), b"")

        body = getattr(result, "body", None)
        wire = WireCodec(contract).body_to_wire(response, _page_items(body) if shape == _PAGE_SHAPE else body)
        visible = run_without_suspension(
            visible_output(self._admitted, self._hooks, call_without_suspension, response, wire)
        )
        media = ir_string(ir_map(contract.format(operation_id), "success"), "media") or JSON_MEDIA
        written, headers = self._written_body(shape, body, visible, status)
        reply = Reply(status, ((CONTENT_TYPE, media), *headers), json_bytes(written))
        if_none_match = self._request.headers.get(_IF_NONE_MATCH)

        return with_cache_headers(contract, operation_id, reply, self._admitted.principal, if_none_match)

    def _written_body(
        self, shape: str, body: object, visible: object, status: int
    ) -> tuple[object, tuple[tuple[str, str], ...]]:
        """The body in its format's envelope, or the page body and the headers its paging style writes."""
        contract, operation_id = self._state.contract, self._state.operation_id
        if shape != _PAGE_SHAPE:
            return success_body(contract.format(operation_id), shape, visible, status, self._request.path), ()

        if not isinstance(visible, list):
            raise BoundaryFailureError(
                f"seampact: the items of operation '{operation_id}' encoded to a {type(visible).__qualname__}, not a "
                "list; return the page's items as a list."
            )

        items: list[object] = visible
        raw_query = str(self._request.META.get(_QUERY_STRING, ""))
        facts = _page_facts(contract, operation_id, body)
        public_origin = configured_origin(contract, configuration_of(contract.api).public_origin())
        page = page_parts(
            contract,
            operation_id,
            self._query,
            raw_query,
            items,
            facts,
            status,
            self._state.request_path,
            public_origin=public_origin,
        )

        return page.body, page.headers


def admit(
    request: HttpRequest, contract: ApiContract, credentials: Mapping[str, CredentialsType], operation_id: str
) -> ContractAdmission:
    """Raises `BoundaryFailureError` without the boundary's mark for this operation, so a view called with no
    boundary fails closed before any input is read; raises `ContractRefusal` for a refused request."""
    state = state_of(request, contract.api)

    if state is None or state.contract is not contract or state.operation_id != operation_id:
        raise BoundaryFailureError(
            f"seampact: the view of operation '{operation_id}' of api '{contract.api}' was reached without the "
            "boundary's mark; list the api's boundary first in MIDDLEWARE, and test through the test Client."
        )

    access = AccessState(
        contract=contract,
        operation_id=operation_id,
        credentials_types=credentials,
        raw_parameters=state.raw_parameters,
        request=RequestView(
            method=request.method or "",
            path=request.path,
            headers=headers_view(_raw_headers(request)),
            client_address=request.META.get("REMOTE_ADDR"),
        ),
        body=state.decoded.body,
        raw_body=state.decoded.raw_body,
    )
    hooks = configuration_of(contract.api).access_hooks(request)
    run_without_suspension(run_access_steps(access, hooks, call_without_suspension))
    state.admitted_operation = operation_id

    return ContractAdmission(request, state, access, hooks)


def _raw_headers(request: HttpRequest) -> list[tuple[bytes, bytes]]:
    """The request's headers in the server's latin-1 text, as `headers_view` reads them."""
    return [(name.encode("latin-1"), value.encode("latin-1")) for name, value in request.headers.items()]


def declared_error_reply(contract: ApiContract, operation_id: str, result: object) -> Reply:
    """A declared error the handler returned instead of raising it."""
    code = getattr(result, "code", None)

    if not isinstance(code, str) or not contract.declares(operation_id, code):
        raise BoundaryFailureError(
            f"seampact: the handler of '{operation_id}' returned a {type(result).__qualname__}; return one of the "
            "operation's generated results."
        )

    params = _params(contract, WireCodec(contract), code, getattr(result, "params", None))

    return error_reply(contract, operation_id, code, params)


def contract_error_reply(contract: ApiContract, operation_id: str, refused: ContractRefusal | Exception) -> Reply:
    """A generated contract exception raised by a handler or a hook, or a boundary refusal."""
    code = getattr(refused, "code", None)

    if not isinstance(code, str) or not contract.declares(operation_id, code):
        raise BoundaryFailureError(
            f"seampact: '{operation_id}' raised the code {code!r}, which the operation does not declare."
        )

    params = getattr(refused, "params", None)

    if isinstance(refused, ContractRefusal):
        return error_reply(contract, operation_id, code, refused.params)

    return error_reply(contract, operation_id, code, _params(contract, WireCodec(contract), code, params))


def _page_items(page: object) -> object:
    return getattr(page, "items", None)


def _page_facts(contract: ApiContract, operation_id: str, page: object) -> dict[str, object]:
    """The facts the paging style reads, by name, from the page the handler returned."""
    style_id = ir_string(ir_map(contract.operation(operation_id), "paging"), "style") or ""
    facts: dict[str, object] = {}

    for fact in ir_strings(contract.declaration("pagings", style_id), "handlerResult"):
        attribute = member_identifier(fact)

        if attribute is None:
            raise BoundaryFailureError(f"seampact: the page fact '{fact}' has no attribute; regenerate the api.")

        facts[fact] = getattr(page, attribute, None)

    return facts


def _params(contract: ApiContract, codec: WireCodec, code: str, params: object) -> Mapping[str, object] | None:
    schema_id = ir_string(contract.catalog_entry(code), "params")

    if params is None or schema_id is None:
        return None

    wire = codec.to_wire({"kind": "ref", "schema": schema_id}, params)

    return wire if isinstance(wire, Mapping) else None
