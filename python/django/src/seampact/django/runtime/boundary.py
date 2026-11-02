"""The base of each api's generated boundary middleware (ADR 0027 "The boundary middleware"): the app lists the
generated class first in `MIDDLEWARE`, and Django builds it once, when it builds the request handler, which runs the
boot check. On a contract request it runs step 1 (the raw-path match, the bounded body read and the decoding) and
answers its own refusals; on the way back it runs the route-chosen check, answers a recorded exception by its role,
and runs the outgoing response check."""

import inspect
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from types import MappingProxyType
from typing import ClassVar, Final

from asgiref.sync import iscoroutinefunction, markcoroutinefunction
from django.conf import settings
from django.core.exceptions import (
    BadRequest,
    DisallowedHost,
    ImproperlyConfigured,
    PermissionDenied,
    RequestDataTooBig,
    SuspiciousOperation,
)
from django.http import Http404, HttpRequest, HttpResponse, HttpResponseBase

from seampact.codegen.runtime.body_reader import PAYLOAD_TOO_LARGE_ROLE
from seampact.codegen.runtime.contract import NOT_FOUND_ROLE, ApiContract
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.framework_routes import FrameworkRouteRule
from seampact.codegen.runtime.framework_versions import AcceptedFramework
from seampact.codegen.runtime.input_decoding import IncomingRequest, Issue, decode_input, role_refusal, schema_invalid
from seampact.codegen.runtime.ir_view import ir_int, ir_map
from seampact.codegen.runtime.raw_target import RawTarget, asgi_raw_target, wsgi_raw_target
from seampact.codegen.runtime.replies import CONTENT_TYPE, role_reply
from seampact.codegen.runtime.reply_verdict import (
    MAX_CHECKED_ERROR_BODY_BYTES,
    FrameworkEtagMode,
    OutgoingReply,
    ResponsesMode,
    verdict,
)
from seampact.codegen.runtime.sync_driver import run_without_suspension
from seampact.django.runtime.api_settings import api_settings
from seampact.django.runtime.boot_check import boot_problems, operation_route_name
from seampact.django.runtime.contract_replies import (
    django_response,
    logger,
    refusal_response,
    report_unexpected,
    role_answer,
    unexpected_response,
)
from seampact.django.runtime.error_handlers import wrap_error_handlers
from seampact.django.runtime.request_state import BoundaryState, attach, state_of

type GetResponse = Callable[[HttpRequest], HttpResponseBase] | Callable[[HttpRequest], Awaitable[HttpResponseBase]]

_NOT_FOUND_STATUS: Final = 404
_ROLE_OF_EXCEPTION: Final = (
    (Http404, NOT_FOUND_ROLE, 404),
    (PermissionDenied, "forbidden", 403),
    (RequestDataTooBig, PAYLOAD_TOO_LARGE_ROLE, 413),
)
_CROSSED: Final = "an exception crossed the boundary"
_HTML: Final = "text/html"
_HEAD: Final = "HEAD"
_WSGI_CHUNK_BYTES: Final = 65536


class ContractBoundary:
    """Runs sync or async, as the middleware inside it lets Django choose (ADR 0027 "Sync and async")."""

    api: ClassVar[str]
    generated_by: ClassVar[str]
    contract: ClassVar[ApiContract]
    settings_keys: ClassVar[Sequence[str]] = ()
    handler_resources: ClassVar[Mapping[str, Sequence[str]]] = MappingProxyType({})
    frameworks: ClassVar[Sequence[AcceptedFramework]] = ()
    framework_routes: ClassVar[Sequence[FrameworkRouteRule]] = ()
    # The target options of ADR 0026 the boundary reads, as the generator recorded them; `settings.SEAMPACT` and an
    # operation's own value win over them.
    responses: ClassVar[str] = "strict"
    body_validation: ClassVar[bool] = False
    framework_etag: ClassVar[str] = "strip"
    catch_all: ClassVar[bool] = True
    boot_check: ClassVar[bool] = True
    boot_check_framework_routes: ClassVar[bool] = True
    boot_check_hooks: ClassVar[bool] = True
    sync_capable: ClassVar[bool] = True
    async_capable: ClassVar[bool] = True
    _gaps_logged: ClassVar[bool] = False

    def __init__(self, get_response: GetResponse) -> None:
        self.get_response = get_response
        self.async_mode = iscoroutinefunction(get_response)

        if self.async_mode:
            markcoroutinefunction(self)

        wrap_error_handlers()
        problems = boot_problems(type(self)) if self.boot_check else []

        if problems:
            listed = "\n".join(f"- {problem}" for problem in problems)
            raise ImproperlyConfigured(f"seampact: the api '{self.api}' cannot start:\n{listed}")

    def __call__(self, request: HttpRequest) -> HttpResponseBase | Awaitable[HttpResponseBase]:
        if self.async_mode:
            return self.__acall__(request)

        early = self._step_one(request)

        if early is not None:
            return _without_head_body(request, early)

        try:
            response = _response(self.get_response(request))
        except Exception as propagated:
            self._report_propagated(request, propagated)
            raise

        return self._checked(request, response)

    async def __acall__(self, request: HttpRequest) -> HttpResponseBase:
        early = self._step_one(request)

        if early is not None:
            return _without_head_body(request, early)

        try:
            reply = self.get_response(request)
            settled: object = await reply if inspect.isawaitable(reply) else reply
        except Exception as propagated:
            self._report_propagated(request, propagated)
            raise

        return self._checked(request, _response(settled))

    def _report_propagated(self, request: HttpRequest, propagated: Exception) -> None:
        """`DEBUG_PROPAGATE_EXCEPTIONS` re-raises into the boundary: it logs, tells the listener, and re-raises."""
        state = state_of(request, self.api)

        if state is not None:
            report_unexpected(request, self.contract, state.operation_id, _CROSSED, propagated)

    def _step_one(self, request: HttpRequest) -> HttpResponseBase | None:
        """The boundary's own reply, or None to hand the request on."""
        target = _raw_target(request)

        if target is None:
            return None

        if not target.raw:
            self._log_gaps_once()

        matched = self.contract.match(request.method or "", target.path)

        if matched is None:
            return None

        if matched.operation_id is None:
            if not self.catch_all:
                return None

            unserved = role_reply(self.contract, None, NOT_FOUND_ROLE, _NOT_FOUND_STATUS)
            return django_response(request, self.contract, unserved)

        operation_id = matched.operation_id
        headers = {name.lower(): value for name, value in request.headers.items()}
        incoming = IncomingRequest(request.method or "", target, headers, self._body_chunks(request, operation_id))

        try:
            decoded = run_without_suspension(
                decode_input(self.contract, operation_id, matched.raw_parameters, incoming)
            )
        except ContractRefusal as refused:
            return refusal_response(request, self.contract, operation_id, refused)
        except BoundaryFailureError as failure:
            return unexpected_response(request, self.contract, operation_id, str(failure), failure)

        attach(request, BoundaryState(self.contract, operation_id, matched.raw_parameters, decoded))

        return None

    async def _body_chunks(self, request: HttpRequest, operation_id: str) -> AsyncIterator[bytes]:
        """`request.body`, so the app can read it again; under WSGI, a chunked body without `Content-Length` from
        `wsgi.input` when the server terminates it, else the client's 400."""
        transfer_encoding = (request.headers.get("Transfer-Encoding") or "").lower()
        chunked_without_length = "CONTENT_LENGTH" not in request.META and "chunked" in transfer_encoding

        if chunked_without_length and not hasattr(request, "scope"):
            for chunk in self._terminated_input(request, operation_id):
                yield chunk
            return

        try:
            body = request.body
        except RequestDataTooBig:
            raise role_refusal(
                self.contract, operation_id, PAYLOAD_TOO_LARGE_ROLE, {"limitBytes": self._limit(operation_id)}
            ) from None

        yield body

    def _terminated_input(self, request: HttpRequest, operation_id: str) -> list[bytes]:
        stream = request.META.get("wsgi.input")

        if request.META.get("wsgi.input_terminated") is not True or stream is None:
            raise schema_invalid(self.contract, operation_id, [Issue("body", "", "type")])

        chunks: list[bytes] = []
        received = 0
        limit = self._limit(operation_id) or 0

        # One chunk past the limit is enough for the bounded read to refuse it.
        while received <= limit and (chunk := stream.read(_WSGI_CHUNK_BYTES)):
            chunks.append(chunk)
            received += len(chunk)

        return chunks

    def _limit(self, operation_id: str) -> int | None:
        return ir_int(ir_map(self.contract.operation(operation_id), "input"), "bodyLimitBytes")

    def _checked(self, request: HttpRequest, response: HttpResponseBase) -> HttpResponseBase:
        state = state_of(request, self.api)

        if state is None:
            return response

        route_check = self._route_chosen(request, state)

        if route_check is not None:
            return _without_head_body(request, route_check)

        recorded = self._recorded_answer(request, state, response)

        if recorded is not None:
            return _without_head_body(request, recorded)

        written = state.authored.find(_outgoing(response), request.method or "")

        if settings.DEBUG and written is None and _is_debug_page(response):
            logger(self.api).warning("seampact: Django's debug page leaves on operation %s", state.operation_id)
            return response

        return _without_head_body(request, self._outgoing_check(request, state, response))

    def _route_chosen(self, request: HttpRequest, state: BoundaryState) -> HttpResponseBase | None:
        """The path's 404 when routing chose another view than the generated one of the matched operation."""
        resolved = request.resolver_match

        if resolved is None:
            return None

        view_class = getattr(resolved.func, "view_class", None)
        own_view = getattr(view_class, "contract", None) is self.contract
        route_name = operation_route_name(self.contract, state.operation_id)

        if own_view and resolved.url_name == route_name:
            return None

        reply = role_reply(self.contract, state.operation_id, NOT_FOUND_ROLE, _NOT_FOUND_STATUS)

        return django_response(request, self.contract, reply)

    def _recorded_answer(
        self, request: HttpRequest, state: BoundaryState, response: HttpResponseBase
    ) -> HttpResponseBase | None:
        """The answer to the exception a wrapped handler or the receiver recorded; None to check the reply as
        written."""
        recorded = state.recorded

        if recorded is None or state.authored.find(_outgoing(response), request.method or "") is not None:
            return None

        if isinstance(recorded, DisallowedHost):
            logger(self.api).warning("seampact: a request for a host this deployment does not serve: %s", recorded)
            return response

        for exception_class, role, status in _ROLE_OF_EXCEPTION:
            if isinstance(recorded, exception_class):
                return self._role_reply(request, state, role, status)

        if isinstance(recorded, BadRequest | SuspiciousOperation):
            return None

        if settings.DEBUG:
            report_unexpected(request, self.contract, state.operation_id, _CROSSED, recorded)
            return response

        return unexpected_response(request, self.contract, state.operation_id, _CROSSED, recorded)

    def _role_reply(self, request: HttpRequest, state: BoundaryState, role: str, status: int) -> HttpResponseBase:
        reply = role_answer(
            self.contract, state.operation_id, role, status, {"limitBytes": self._limit(state.operation_id)}
        )

        if reply is None:
            reason = f"the operation declares no code for the role '{role}' nor a single code of status {status}"
            return unexpected_response(request, self.contract, state.operation_id, reason, state.recorded)

        return django_response(request, self.contract, reply)

    def _outgoing_check(
        self, request: HttpRequest, state: BoundaryState, response: HttpResponseBase
    ) -> HttpResponseBase:
        judged = verdict(
            self.contract,
            state.operation_id,
            _outgoing(response),
            authored=state.authored,
            method=request.method or "",
            admitted=state.admitted_operation == state.operation_id,
            responses=self._responses_mode(state.operation_id),
            framework_etag=FrameworkEtagMode(self.framework_etag),
        )

        if judged.violation is not None:
            report_unexpected(request, self.contract, state.operation_id, f"outgoing check: {judged.violation}", None)

        if judged.replaced:
            replaced = HttpResponse(judged.reply.body or b"", status=judged.reply.status)

            for name, value in judged.reply.headers:
                replaced[name] = value

            return replaced

        if judged.reply.header("etag") is None and response.has_header("ETag"):
            del response["ETag"]

        return response

    def _responses_mode(self, operation_id: str) -> ResponsesMode:
        """The operation's `responses` in `settings.SEAMPACT`, else the api's, else the generated option."""
        own = api_settings(self.api)
        operations = own.get("operations")
        operation = operations.get(operation_id) if isinstance(operations, dict) else None
        mode = operation.get("responses") if isinstance(operation, dict) else None

        return ResponsesMode(str(mode or own.get("responses") or self.responses))

    @classmethod
    def _log_gaps_once(cls) -> None:
        if cls._gaps_logged:
            return

        cls._gaps_logged = True
        logging.getLogger(f"seampact.{cls.api}").warning(
            "seampact: the server gives no raw request target, so the boundary matches the decoded path: an encoded "
            "slash, an encoded dot segment and a raw ';' in a path cannot be refused, and a chunked request body "
            "without Content-Length is refused. Serve the app with gunicorn or uvicorn."
        )


def _raw_target(request: HttpRequest) -> RawTarget | None:
    scope = getattr(request, "scope", None)

    if isinstance(scope, dict):
        return asgi_raw_target(scope)

    return wsgi_raw_target(request.META)


def _response(reply: object) -> HttpResponseBase:
    if not isinstance(reply, HttpResponseBase):
        raise BoundaryFailureError(
            f"seampact: the middleware inside the boundary answered a {type(reply).__qualname__}, not a response."
        )

    return reply


def _outgoing(response: HttpResponseBase) -> OutgoingReply:
    headers = tuple((name.lower(), value) for name, value in response.items())

    if response.streaming or not isinstance(response, HttpResponse):
        return OutgoingReply(response.status_code, headers, None)

    body = response.content

    return OutgoingReply(response.status_code, headers, body if len(body) <= MAX_CHECKED_ERROR_BODY_BYTES else None)


def _is_debug_page(response: HttpResponseBase) -> bool:
    return str(response.get(CONTENT_TYPE) or "").startswith(_HTML)


def _without_head_body(request: HttpRequest, response: HttpResponseBase) -> HttpResponseBase:
    """`HEAD` runs the path's `GET` operation; the boundary drops the body."""
    if (request.method or "").upper() == _HEAD and isinstance(response, HttpResponse):
        response.content = b""

    return response
