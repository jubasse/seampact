"""What a generated DRF view does once DRF's `initial()` ran (ADR 0027 "DRF"): it checks the boundary's mark and
the chosen route, refuses by name an operation whose features this release does not serve, runs steps 2 to 5, and
then reads the input (steps 6 to 8) and writes the handler's result with the boundary's own encoding."""

import inspect
from collections.abc import Mapping
from typing import Final

from django.http import HttpRequest, HttpResponseBase

from seampact.codegen.runtime.access_steps import AccessState, CredentialsType, headers_view, run_access_steps
from seampact.codegen.runtime.contract import ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.input_decoding import schema_invalid
from seampact.codegen.runtime.ir_view import ir_int, ir_map, ir_maps, ir_string
from seampact.codegen.runtime.replies import CONTENT_TYPE, JSON_MEDIA, Reply, error_reply, json_bytes, success_body
from seampact.codegen.runtime.sync_driver import call_without_suspension, run_without_suspension
from seampact.codegen.runtime.wire_codec import WireCodec
from seampact.django.runtime.api_settings import access_hooks
from seampact.django.runtime.contract_replies import django_response
from seampact.django.runtime.request_state import BoundaryState, state_of
from seampact.drf.runtime.serializers import ContractSerializer
from seampact.drf.runtime.typed_input import built_input, rendered, serializer_issues, typed_parts
from seampact.hooks import RequestView, ResolvedScope

_EMPTY_SHAPE: Final = "empty"
_EXEMPT: Final = "exempt"
_ABSOLUTE_URLS: Final = "absolute"
# The operation features a later release of seampact-drf serves; an operation that declares one is refused by name.
_LATER_FEATURES: Final = (
    ("paging", "paging"),
    ("cache", "cache headers"),
    ("concurrency", "the concurrency version check"),
    ("fieldRights", "restricted fields"),
    ("bindings", "principal bindings"),
    ("upstream", "relays"),
)


class ContractAdmission:
    """A request the view admitted, and what it reads next."""

    def __init__(self, request: HttpRequest, state: BoundaryState, admitted: AccessState) -> None:
        self._request = request
        self._state = state
        self._admitted = admitted

    def input[I](self, serializer: type[ContractSerializer], input_type: type[I]) -> I:
        contract, operation_id = self._state.contract, self._state.operation_id
        parts = typed_parts(contract, operation_id, self._state.decoded)
        validating = serializer(data=parts.tree)
        valid = validating.is_valid()
        issues = parts.issues + ([] if valid else serializer_issues(contract, operation_id, validating.errors))

        if issues:
            raise schema_invalid(contract, operation_id, rendered(issues))

        validated = validating.validated_data

        if not isinstance(validated, Mapping):
            raise BoundaryFailureError(f"seampact: the serializer of '{operation_id}' validated no mapping.")

        return built_input(input_type, validated)

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

        return django_response(
            self._request, contract, result_reply(contract, operation_id, self._request.path, result)
        )


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

    _refuse_later_features(contract, operation_id)
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
    )
    run_without_suspension(run_access_steps(access, access_hooks(contract.api, request), call_without_suspension))
    state.admitted_operation = operation_id

    return ContractAdmission(request, state, access)


def _raw_headers(request: HttpRequest) -> list[tuple[bytes, bytes]]:
    """The request's headers in the server's latin-1 text, as `headers_view` reads them."""
    return [(name.encode("latin-1"), value.encode("latin-1")) for name, value in request.headers.items()]


def result_reply(contract: ApiContract, operation_id: str, path: str, result: object) -> Reply:
    codec = WireCodec(contract)
    status = getattr(type(result), "status", None)

    if isinstance(status, int):
        return _success(contract, codec, operation_id, path, status, result)

    code = getattr(result, "code", None)

    if not isinstance(code, str) or not contract.declares(operation_id, code):
        raise BoundaryFailureError(
            f"seampact: the handler of '{operation_id}' returned a {type(result).__qualname__}; return one of the "
            "operation's generated results."
        )

    return error_reply(contract, operation_id, code, _params(contract, codec, code, getattr(result, "params", None)))


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


def _success(
    contract: ApiContract, codec: WireCodec, operation_id: str, path: str, status: int, result: object
) -> Reply:
    response = next(
        (item for item in ir_maps(contract.operation(operation_id), "responses") if ir_int(item, "status") == status),
        None,
    )

    if response is None:
        raise BoundaryFailureError(f"seampact: operation '{operation_id}' declares no {status} reply.")

    shape = ir_string(response, "shape") or ""

    if shape == _EMPTY_SHAPE:
        return Reply(status, (), b"")

    format_ = contract.format(operation_id)
    body = success_body(format_, shape, codec.body_to_wire(response, getattr(result, "body", None)), status, path)
    media = ir_string(ir_map(format_, "success"), "media") or JSON_MEDIA

    return Reply(status, ((CONTENT_TYPE, media),), json_bytes(body))


def _params(contract: ApiContract, codec: WireCodec, code: str, params: object) -> Mapping[str, object] | None:
    schema_id = ir_string(contract.catalog_entry(code), "params")

    if params is None or schema_id is None:
        return None

    wire = codec.to_wire({"kind": "ref", "schema": schema_id}, params)

    return wire if isinstance(wire, Mapping) else None


def _refuse_later_features(contract: ApiContract, operation_id: str) -> None:
    operation = contract.operation(operation_id)
    later = [description for key, description in _LATER_FEATURES if operation.get(key)]
    idempotency = ir_map(operation, "idempotency")

    if idempotency and ir_string(idempotency, "kind") != _EXEMPT:
        later.append("idempotency")

    if ir_string(ir_map(ir_map(contract.ir_view, "api"), "wire"), "urls") == _ABSOLUTE_URLS:
        later.append("absolute URLs")

    if later:
        raise BoundaryFailureError(
            f"seampact: operation '{operation_id}' of api '{contract.api}' declares {', '.join(later)}, which this "
            "release of seampact-drf does not serve yet; the request is refused rather than served unchecked."
        )
