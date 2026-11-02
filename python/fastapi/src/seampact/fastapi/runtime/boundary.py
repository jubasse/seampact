"""The boundary of one api (ADR 0026 "Placement", "Routes" and "The outgoing response check"): a pure ASGI middleware,
the outermost of `app.user_middleware`. On a contract request it runs step 1 (the raw-path match, the bounded body
read and the decoding) and answers its own refusals; it replays the body to the app, holds the reply's start until the
verdict of step 10, maps an `HTTPException` the app's handlers rendered to its role, and answers the api's 500 for an
exception that crosses it. On `lifespan.startup` it runs the boot check, with a first-request fallback."""

import asyncio
import traceback
from collections.abc import AsyncIterator, MutableMapping
from typing import Final

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from seampact.codegen.runtime.contract import NOT_FOUND_ROLE
from seampact.codegen.runtime.failures import BoundaryFailureError, ContractRefusal
from seampact.codegen.runtime.input_decoding import IncomingRequest, decode_input
from seampact.codegen.runtime.raw_target import RawTarget, asgi_raw_target, without_origin
from seampact.codegen.runtime.replies import Reply, error_reply, internal_error_reply, role_reply
from seampact.codegen.runtime.reply_verdict import MAX_CHECKED_ERROR_BODY_BYTES, OutgoingReply, verdict
from seampact.fastapi.runtime.api_binding import ApiBinding
from seampact.fastapi.runtime.boot_check import BootCheckError, boot_problems, override_problems
from seampact.fastapi.runtime.exception_roles import exception_reply
from seampact.fastapi.runtime.request_state import RequestState, scope_states

_HTTP: Final = "http"
_LIFESPAN: Final = "lifespan"
_STARTUP_COMPLETE: Final = "lifespan.startup.complete"
_HEAD: Final = "HEAD"
_NOT_FOUND_STATUS: Final = 404
_CONTENT_LENGTH: Final = "content-length"
_BYTES_AS_TEXT: Final = "latin-1"
_RAW_PATH_RULES: Final = (
    "a percent-encoded static segment, an encoded slash or dot segment, and a raw ';' in a path value cannot be told "
    "from their decoded form"
)


class ContractBoundary:
    def __init__(self, app: ASGIApp, binding: ApiBinding) -> None:
        self.app = app
        self.binding = binding
        self._check_lock = asyncio.Lock()
        self._decoded_path_logged = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == _LIFESPAN:
            await self.app(scope, receive, self._lifespan_send(send))
            return

        if scope["type"] != _HTTP:
            await self.app(scope, receive, send)
            return

        target = asgi_raw_target(scope)
        contract = self.binding.contract
        method = str(scope["method"])
        matched = None if target is None else contract.match(method, target.path)

        if target is None or matched is None:
            await self._pass_or_refuse_encoded(scope, receive, send, method)
            return

        if not target.raw:
            self._log_decoded_path_once()

        _drop_absolute_form_origin(scope)

        problems = await self._problems()

        if problems:
            self.binding.logger.error(
                "seampact: the api '%s' cannot serve contract requests:\n- %s", self.binding.api, "\n- ".join(problems)
            )
            await _send_reply(send, internal_error_reply(contract, matched.operation_id), method)
            return

        if matched.operation_id is None:
            if not self.binding.placement.defaults.catch_all:
                await self.app(scope, receive, send)
                return

            await _send_reply(send, role_reply(contract, None, NOT_FOUND_ROLE, _NOT_FOUND_STATUS), method)
            return

        await self._serve(scope, receive, send, target, matched.operation_id, dict(matched.raw_parameters))

    async def _serve(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        target: RawTarget,
        operation_id: str,
        raw_parameters: dict[str, str],
    ) -> None:
        contract = self.binding.contract
        method = str(scope["method"])
        received = _ReceivedBody(receive)
        headers: dict[str, str] = {}

        for name, value in scope["headers"]:
            headers.setdefault(name.decode(_BYTES_AS_TEXT).lower(), value.decode(_BYTES_AS_TEXT))

        try:
            decoded = await decode_input(
                contract, operation_id, raw_parameters, IncomingRequest(method, target, headers, received.chunks())
            )
        except ContractRefusal as refusal:
            await _send_reply(send, error_reply(contract, operation_id, refusal.code, refusal.params), method)
            return

        state = RequestState(
            contract=contract,
            operation_id=operation_id,
            method=method,
            target=target,
            raw_parameters=raw_parameters,
            decoded=decoded,
        )
        scope_states(scope)[self.binding.api] = state
        checked = _CheckedReply(self.binding, scope, state, send)

        try:
            await self.app(scope, received.replay(), checked.send)
        except Exception as failure:
            await self._failed(state, checked, failure, send)
            return

        await checked.finish()

    async def _pass_or_refuse_encoded(self, scope: Scope, receive: Receive, send: Send, method: str) -> None:
        """A raw path that is no contract path, but whose decoded form is (an encoded static segment, `/%761/...`):
        the router would route the decoded form, so the boundary answers the api's not-found 404 itself."""
        decoded = asgi_raw_target({name: value for name, value in scope.items() if name != "raw_path"})
        matched = None if decoded is None else self.binding.contract.match(method, decoded.path)

        if matched is None or (matched.operation_id is None and not self.binding.placement.defaults.catch_all):
            await self.app(scope, receive, send)
            return

        reply = role_reply(self.binding.contract, None, NOT_FOUND_ROLE, _NOT_FOUND_STATUS)
        await _send_reply(send, reply, method)

    async def _failed(self, state: RequestState, checked: "_CheckedReply", failure: Exception, send: Send) -> None:
        """An exception that crossed the app: the api's 500 when no byte went out, else a body cut short; under
        `app.debug` nothing is sent and it is raised again after its log line, so Starlette's debug page shows it."""
        reason = _failure_place(failure)

        # The message may carry an input value: it reaches the log only under `app.debug`.
        if self.binding.app.debug and not isinstance(failure, BoundaryFailureError):
            reason = f"{reason}: {failure}"

        await self.binding.tell_listener(state.operation_id, reason, failure, state.listener)

        if self.binding.app.debug:
            raise failure

        if not checked.started:
            await _send_reply(send, internal_error_reply(state.contract, state.operation_id), state.method)

    async def _problems(self) -> list[str]:
        """The boot check's problems, run once on the first request when no lifespan ran, and the dependency
        overrides a test may set after start."""
        if self.binding.boot_problems is None:
            async with self._check_lock:
                if self.binding.boot_problems is None:
                    self.binding.boot_problems = boot_problems(self.binding)

        return [*self.binding.boot_problems, *override_problems(self.binding)]

    def _lifespan_send(self, send: Send) -> Send:
        async def lifespan_send(message: Message) -> None:
            if message["type"] == _STARTUP_COMPLETE:
                problems = boot_problems(self.binding)
                self.binding.boot_problems = problems

                if problems:
                    # Raised, not answered: Starlette then sends `lifespan.startup.failed`, and `TestClient` raises.
                    raise BootCheckError(self.binding.api, problems)

            await send(message)

        return lifespan_send

    def _log_decoded_path_once(self) -> None:
        if self._decoded_path_logged:
            return

        self._decoded_path_logged = True
        self.binding.logger.warning(
            "seampact: the ASGI server gives no raw_path, so the '%s' boundary matches the decoded path: %s.",
            self.binding.api,
            _RAW_PATH_RULES,
        )


class _ReceivedBody:
    """The request body as received, read once by step 1 and replayed to the app as the same bytes."""

    def __init__(self, receive: Receive) -> None:
        self._receive = receive
        self._read: bytearray | None = None

    async def chunks(self) -> AsyncIterator[bytes]:
        self._read = bytearray()

        while True:
            message = await self._receive()

            if message["type"] != "http.request":
                return

            chunk = bytes(message.get("body", b""))
            self._read.extend(chunk)
            yield chunk

            if not message.get("more_body", False):
                return

    def replay(self) -> Receive:
        if self._read is None:
            return self._receive

        body = bytes(self._read)
        replayed = False

        async def receive() -> Message:
            nonlocal replayed

            if replayed:
                return await self._receive()

            replayed = True

            return {"type": "http.request", "body": body, "more_body": False}

        return receive


class _CheckedReply:
    """The wrapped `send` of one contract request: the start is held until the verdict, then the messages pass on."""

    def __init__(self, binding: ApiBinding, scope: MutableMapping[str, object], state: RequestState, send: Send):
        self._binding = binding
        self._scope = scope
        self._state = state
        self._send = send
        self._start: Message | None = None
        self._held = bytearray()
        self._held_whole = True
        self._passing = False
        self._replaced = False
        self.started = False

    async def send(self, message: Message) -> None:
        kind = message["type"]

        if self._replaced:
            return

        if self._passing:
            await self._pass(message)
            return

        if kind == "http.response.start":
            self._start = message
            replacement = self._replacement()

            if replacement is not None:
                await self._replace(replacement)
            elif _status(message) < 400 and not self._authored_status(message):
                await self._judge(None, final=False)

            return

        if kind != "http.response.body":
            await self._judge_before(message)
            return

        self._hold(message)
        final = not message.get("more_body", False)

        if final or not self._held_whole:
            await self._judge(bytes(self._held) if self._held_whole else None, final=final)

    async def finish(self) -> None:
        """A reply whose last body message never came is judged on what was held, and ends there."""
        if self._start is not None and not self._passing and not self._replaced:
            await self._judge(bytes(self._held) if self._held_whole else None, final=True)

    def _hold(self, message: Message) -> None:
        chunk = bytes(message.get("body", b""))

        if (
            self._held_whole
            and not self._authored_status(self._start)
            and len(self._held) + len(chunk) > MAX_CHECKED_ERROR_BODY_BYTES
        ):
            self._held_whole = False

        self._held.extend(chunk)

    def _authored_status(self, start: Message | None) -> bool:
        return start is not None and any(written.status == _status(start) for written in self._state.authored.replies)

    def _replacement(self) -> Reply | None:
        """The route FastAPI's router chose must be the contract route of the matched operation; an `HTTPException`
        the app's handlers rendered answers with its role."""
        contract = self._state.contract
        route = self._scope.get("route")
        expected = contract.route_name(self._state.operation_id)

        if getattr(route, "name", None) != expected:
            return role_reply(contract, self._state.operation_id, NOT_FOUND_ROLE, _NOT_FOUND_STATUS)

        exception = self._state.http_exception

        if exception is None or self._start is None or exception.status_code != _status(self._start):
            return None

        return exception_reply(self._binding, self._state, exception)

    async def _judge_before(self, message: Message) -> None:
        """A message that is no body message (`pathsend`, `zerocopy`) after a held start: the body cannot be checked,
        so the verdict comes first, then the message, which a replaced reply drops."""
        if self._start is None:
            await self._send(message)
            return

        await self._judge(None, final=False, following=message)

    async def _judge(self, body: bytes | None, *, final: bool, following: Message | None = None) -> None:
        """`body` is None when the reply's body cannot be checked whole; `final` when no body message follows."""
        if self._start is None:
            return

        operation_id = self._state.operation_id
        headers = tuple(
            (name.decode(_BYTES_AS_TEXT).lower(), value.decode(_BYTES_AS_TEXT))
            for name, value in self._start.get("headers", [])
        )
        judged = verdict(
            self._state.contract,
            operation_id,
            OutgoingReply(_status(self._start), headers, body),
            authored=self._state.authored,
            method=self._state.method,
            admitted=self._state.admitted,
            responses=self._binding.responses(operation_id),
            framework_etag=self._binding.placement.defaults.framework_etag,
        )

        if judged.violation is not None:
            await self._binding.tell_listener(
                operation_id, f"the outgoing check found {judged.violation}", None, self._state.listener
            )

        if judged.replaced:
            await self._replace(Reply(judged.reply.status, judged.reply.headers, judged.reply.body or b""))
            return

        self._passing = True
        self.started = True
        start = dict(self._start)
        start["headers"] = [
            (name.encode(_BYTES_AS_TEXT), value.encode(_BYTES_AS_TEXT)) for name, value in judged.reply.headers
        ]
        await self._send(start)

        if following is None:
            await self._pass({"type": "http.response.body", "body": bytes(self._held), "more_body": not final})
            return

        if self._held:
            await self._pass({"type": "http.response.body", "body": bytes(self._held), "more_body": True})

        await self._pass(following)

    async def _pass(self, message: Message) -> None:
        if message["type"] == "http.response.body" and self._state.method.upper() == _HEAD:
            message = {**message, "body": b""}

        await self._send(message)

    async def _replace(self, reply: Reply) -> None:
        self._replaced = True
        self.started = True
        await _send_reply(self._send, self._state.authored.author(reply), self._state.method)


async def _send_reply(send: Send, reply: Reply, method: str) -> None:
    headers = [(name.encode(_BYTES_AS_TEXT), value.encode(_BYTES_AS_TEXT)) for name, value in reply.headers]
    headers.append((_CONTENT_LENGTH.encode(_BYTES_AS_TEXT), str(len(reply.body)).encode(_BYTES_AS_TEXT)))
    await send({"type": "http.response.start", "status": reply.status, "headers": headers})
    await send({"type": "http.response.body", "body": b"" if method.upper() == _HEAD else reply.body})


def _failure_place(failure: Exception) -> str:
    """The exception's class and where it was raised; the boundary's own failures name no input and keep their
    message."""
    if isinstance(failure, BoundaryFailureError):
        return str(failure)

    frames = traceback.extract_tb(failure.__traceback__)
    where = f"{frames[-1].filename}:{frames[-1].lineno}" if frames else "an unknown place"

    return f"{type(failure).__qualname__} raised at {where}"


def _status(message: Message) -> int:
    status = message.get("status")

    return status if isinstance(status, int) else 0


def _drop_absolute_form_origin(scope: Scope) -> None:
    """uvicorn keeps an absolute-form target's `scheme://authority` in both `path` and `raw_path`, and Starlette routes
    `path`: the app receives them without it, as the raw match read them."""
    scope["path"] = without_origin(str(scope["path"]))
    raw_path = scope.get("raw_path")

    if isinstance(raw_path, bytes):
        scope["raw_path"] = without_origin(raw_path.decode(_BYTES_AS_TEXT)).encode(_BYTES_AS_TEXT)
