"""The boundary of the golden `tasks` api at the ASGI level: step 1 on encoded paths, the held reply's final message,
the boot check of an `APIRouter` target and of `frontend()` routes, step 6 on body proofs, and the redacted state."""

import asyncio
import importlib
from collections.abc import Callable
from pathlib import Path
from types import ModuleType

import fastapi
import pytest
from starlette.types import Message

import seampact.fastapi.runtime as fastapi_runtime
from seampact.codegen.runtime.access_steps import AccessState
from seampact.codegen.runtime.failures import ContractRefusal
from seampact.codegen.runtime.input_decoding import DecodedInput
from seampact.codegen.runtime.raw_target import RawTarget
from seampact.fastapi.runtime import ApiBinding, OperationTypes, ResponsesMode
from seampact.fastapi.runtime.boot_check import boot_problems
from seampact.fastapi.runtime.contract_input import InputBuilder
from seampact.fastapi.runtime.request_state import RequestState
from seampact.hooks import RequestView

_GOLDEN_PLACEMENT = "fastapi_tests.golden.reference.tasks.fastapi"
_LARGE_ERROR_BODY_BYTES = 70_000
_TEAPOT_STATUS = 400


class _TeapotError(Exception):
    pass


class _AppEndpoints:
    def health(self, request: object, /) -> object:
        raise _TeapotError


def _placement() -> ModuleType:
    return importlib.import_module(_GOLDEN_PLACEMENT)


def _bind(target: fastapi.FastAPI | fastapi.APIRouter, app: fastapi.FastAPI, **settings: object) -> ApiBinding:
    placement = _placement()
    bind: Callable[..., None] = placement.bind_tasks
    handlers = placement.TasksHandlerFactories(
        tasks=object, drafts=object, channels=object, preferences=object, app=_AppEndpoints, hooks=object
    )
    bind(target, handlers=handlers, **({} if target is app else {"app": app}), **settings)
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    return binding


def _served_app(**settings: object) -> fastapi.FastAPI:
    """The app with the boot check passed by hand: the golden api declares features this release refuses at boot."""
    app = fastapi.FastAPI()
    _bind(app, app, **settings).boot_problems = []

    return app


def _call(app: fastapi.FastAPI, method: str, raw_path: bytes) -> list[Message]:
    sent: list[Message] = []
    path = raw_path.decode("latin-1").replace("%76", "v")
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": raw_path,
        "root_path": "",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("testserver", 80),
    }

    async def receive() -> Message:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: Message) -> None:
        sent.append(message)

    asyncio.run(app(scope, receive, send))

    return sent


def test_an_encoded_base_path_segment_answers_the_api_not_found() -> None:
    sent = _call(_served_app(), "GET", b"/%761/health")

    assert sent[0]["type"] == "http.response.start"
    assert sent[0]["status"] == 404
    assert dict(sent[0]["headers"]).get(b"content-type", b"").endswith(b"json")


def test_an_unauthored_error_reply_over_the_checked_size_sent_at_once_completes_under_warn() -> None:
    app = fastapi.FastAPI()

    async def teapot(request: fastapi.Request, error: Exception) -> fastapi.Response:
        return fastapi.Response(b"x" * _LARGE_ERROR_BODY_BYTES, status_code=_TEAPOT_STATUS, media_type="text/plain")

    app.add_exception_handler(_TeapotError, teapot)
    _bind(app, app, responses=ResponsesMode.WARN).boot_problems = []

    sent = _call(app, "GET", b"/v1/health")
    bodies = [message for message in sent if message["type"] == "http.response.body"]

    assert sent[0]["status"] == _TEAPOT_STATUS
    assert sum(len(message.get("body", b"")) for message in bodies) == _LARGE_ERROR_BODY_BYTES
    assert bodies[-1].get("more_body", False) is False


def test_a_router_target_included_under_a_prefix_fails_the_boot_check_pointing_to_mount() -> None:
    app = fastapi.FastAPI()
    router = fastapi.APIRouter()
    binding = _bind(router, app)
    app.include_router(router, prefix="/x")

    problems = boot_problems(binding)

    assert any("'GET /v1/health'" in problem and "mount" in problem for problem in problems)


def test_a_router_target_under_an_app_route_that_takes_the_path_fails_the_boot_check() -> None:
    app = fastapi.FastAPI()

    @app.get("/v1/health")
    def health() -> None:
        return None

    router = fastapi.APIRouter()
    binding = _bind(router, app)
    app.include_router(router)

    problems = boot_problems(binding)

    assert any("'GET /v1/health'" in problem and "/v1/health" in problem for problem in problems)


def test_a_router_target_included_with_no_prefix_passes_the_route_check() -> None:
    app = fastapi.FastAPI()
    router = fastapi.APIRouter()
    binding = _bind(router, app)
    app.include_router(router)

    problems = boot_problems(binding)

    assert not any("'GET /v1/health'" in problem for problem in problems)


def test_a_frontend_route_under_a_base_path_fails_the_boot_check(tmp_path: Path) -> None:
    app = fastapi.FastAPI()
    app.frontend("/v1/ui", directory=tmp_path)
    binding = _bind(app, app)

    problems = boot_problems(binding)

    assert any("frontend" in problem and "/v1/ui" in problem for problem in problems)


def test_step_6_checks_a_body_proof_by_its_full_type(monkeypatch: pytest.MonkeyPatch) -> None:
    recorded: dict[str, OperationTypes] = {}
    add_operation = fastapi_runtime.add_operation

    def recording(
        binding: ApiBinding, operation_id: str, handlers: object, invoke: object, types: OperationTypes
    ) -> None:
        recorded[operation_id] = types
        add_operation(binding, operation_id, handlers, invoke, types)  # type: ignore[arg-type]

    monkeypatch.setattr(fastapi_runtime, "add_operation", recording)
    app = fastapi.FastAPI()
    binding = _bind(app, app)
    builder = InputBuilder(binding.contract, "purgeTask", recorded["purgeTask"])
    decoded = DecodedInput(path={}, query={}, headers={}, body={"reauthToken": ""}, raw_body=None)
    access = AccessState(
        contract=binding.contract,
        operation_id="purgeTask",
        credentials_types={},
        raw_parameters={},
        request=RequestView(method="POST", path="/", headers={}),
        body=decoded.body,
    )

    with pytest.raises(ContractRefusal) as refused:
        builder.build(decoded, access, "")

    params = refused.value.params or {}
    issues = params.get("issues")
    assert isinstance(issues, list)
    assert {"pointer": "/reauthToken", "rule": "minLength"} in issues


def test_the_request_state_repr_shows_no_parameter_or_typed_request() -> None:
    app = fastapi.FastAPI()
    binding = _bind(app, app)
    state = RequestState(
        contract=binding.contract,
        operation_id="purgeTask",
        method="POST",
        target=RawTarget("/v1/channels/c/tasks/t/purge", "", raw=True),
        raw_parameters={"taskId": "task-of-alice"},
        decoded=DecodedInput(path={}, query={}, headers={}, body=None, raw_body=None),
        typed_request="request-with-hunter2",
    )

    rendered = repr(state)

    assert "task-of-alice" not in rendered
    assert "hunter2" not in rendered


def test_an_app_route_under_a_base_path_inside_an_included_router_fails_the_boot_check() -> None:
    app = fastapi.FastAPI()
    outer = fastapi.APIRouter(prefix="/v1")
    admin = fastapi.APIRouter()

    @admin.get("/admin")
    def admin_page() -> None:
        return None

    outer.include_router(admin, prefix="/tools")
    app.include_router(outer)
    binding = _bind(app, app)

    problems = boot_problems(binding)

    assert any("'/v1/tools/admin'" in problem for problem in problems)
