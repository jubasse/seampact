"""A relayed operation on the FastAPI placement: the golden `tasksService` api's `getTask` relays the `tasks` api's, and
is served as any operation, the boot check passing it. Its handler reads the time the caller's `X-Deadline` leaves, and
a passed deadline answers the operation's `deadlineExceeded` code before the handler runs."""

import importlib
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from types import ModuleType
from typing import Final

import fastapi
from fastapi.testclient import TestClient

from seampact.fastapi.runtime import ApiBinding
from seampact.fastapi.runtime.boot_check import boot_problems
from seampact.hooks import (
    AuthenticateRequest,
    AuthenticateResult,
    Decision,
    RequirementRequest,
    authenticate_result,
    decision,
)

_GOLDEN_SERVICE_API: Final = "fastapi_tests.golden.reference.tasks_service"
_TASK_ID: Final = uuid.UUID("20000000-0000-4000-8000-000000000001")
_TASK_PATH: Final = f"/internal/v1/channels/10000000-0000-4000-8000-000000000001/tasks/{_TASK_ID}"
_DEADLINE_HEADER: Final = "X-Deadline"
_DEADLINE_EXCEEDED: Final = "api.deadline_exceeded"
_CALLER_SERVICE_RIGHT: Final = "callerService"

# The milliseconds the handler read from the request's deadline, one entry per call.
_time_left_seen: list[int] = []


def _module(name: str) -> ModuleType:
    return importlib.import_module(f"{_GOLDEN_SERVICE_API}.{name}")


class _AdmittedService:
    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        schemas = _module("schemas")
        principal = schemas.ServicePrincipal(service=next(iter(schemas.Service)), user_id=uuid.uuid4())

        return authenticate_result.Authenticated(principal=principal)


class _AllowingDecider:
    def decide(self, request: RequirementRequest) -> Decision:
        return decision.Allowed()


class _InternalEndpoints:
    def get_task(self, request: object, /) -> object:
        deadline = getattr(request, "deadline", None)
        assert deadline is not None
        _time_left_seen.append(deadline.remaining_ms(datetime.now(UTC)))
        schemas = _module("schemas")
        task = schemas.Task(
            task_id=_TASK_ID, title="Relayed", state=schemas.TaskState.OPEN, version=1, created_at=datetime.now(UTC)
        )

        return _module("operations").GetTaskResponse200(task)


def _service_app() -> tuple[fastapi.FastAPI, ApiBinding]:
    app = fastapi.FastAPI()
    placement = _module("fastapi")
    bind: Callable[..., None] = placement.bind_tasks_service
    bind(
        app,
        handlers=placement.TasksServiceHandlerFactories(internal=_InternalEndpoints),
        authenticate={"service": _AdmittedService},
        deciders={_CALLER_SERVICE_RIGHT: _AllowingDecider},
    )
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    return app, binding


def _deadline_in(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat().replace("+00:00", "Z")


def test_the_boot_check_passes_a_relayed_operation() -> None:
    _, binding = _service_app()

    assert boot_problems(binding) == []


def test_a_relayed_operation_is_served_and_its_handler_reads_the_time_left() -> None:
    app, _ = _service_app()
    _time_left_seen.clear()

    with TestClient(app) as client:
        response = client.get(
            _TASK_PATH, headers={"Authorization": "Bearer service", _DEADLINE_HEADER: _deadline_in(timedelta(hours=1))}
        )

    assert response.status_code == 200
    assert response.json()["taskId"] == str(_TASK_ID)
    assert len(_time_left_seen) == 1
    assert 0 < _time_left_seen[0] <= timedelta(hours=1).total_seconds() * 1000


def test_a_passed_deadline_answers_deadline_exceeded_before_the_handler() -> None:
    app, _ = _service_app()
    _time_left_seen.clear()

    with TestClient(app) as client:
        response = client.get(
            _TASK_PATH, headers={"Authorization": "Bearer service", _DEADLINE_HEADER: _deadline_in(-timedelta(hours=1))}
        )

    assert _DEADLINE_EXCEEDED in response.text
    assert _time_left_seen == []
