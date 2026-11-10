"""The FastAPI placement of api 'tasksService'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import seampact.fastapi.runtime as _runtime
import seampact.hooks as _hooks

from . import contract as _contract
from .operations import (
    GetTaskErrors,
    GetTaskRequest,
    GetTaskResponse200,
    GetTaskResult,
    InternalEndpoints,
    ServiceCredentials,
    TasksServiceContractError,
)

GENERATED_BY: _typing.Final = "1.1.0"


PLACEMENT: _typing.Final = _runtime.ApiPlacement(
    api="tasksService",
    generated_by=GENERATED_BY,
    mount="",
    routes=(
        _runtime.OperationRoute(
            "getTask",
            "seampact.tasksService.getTask",
            "/internal/v1/channels/{channel_id}/tasks/{task_id}",
            ("GET", "HEAD"),
        ),
    ),
    error_base=TasksServiceContractError,
    defaults=_runtime.TargetDefaults(
        responses=_runtime.ResponsesMode.STRICT,
        body_validation=False,
        framework_etag=_runtime.FrameworkEtagMode.STRIP,
        catch_all=True,
    ),
    boot_check=_runtime.BootCheckSwitches(
        enabled=True, framework_routes=_runtime.FrameworkRoutesCheck.ON, hooks=_runtime.HooksCheck.ERROR
    ),
    framework_routes=(),
    frameworks=(
        _runtime.AcceptedFramework(package="fastapi", unit=_runtime.VersionUnit.MINOR, accepted=("0.162",)),
        _runtime.AcceptedFramework(package="starlette", unit=_runtime.VersionUnit.MAJOR, accepted=("0", "1")),
        _runtime.AcceptedFramework(package="pydantic", unit=_runtime.VersionUnit.MAJOR, accepted=("2",)),
    ),
    credentials={
        "service": _runtime.CredentialsType(ServiceCredentials, {"internalToken": "internal_token"}),
    },
)


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class TasksServiceHandlerFactories:
    """The FastAPI dependency that builds each endpoints protocol's handlers; None fails the boot."""

    internal: _runtime.Factory[InternalEndpoints] | None


class TasksServiceUnexpectedErrorListener(_hooks.UnexpectedErrorListener, _typing.Protocol):
    """Hears of each failure api 'tasksService' answers with its 500."""


async def _call_get_task(endpoints: InternalEndpoints, request: GetTaskRequest) -> GetTaskResult:
    return await _runtime.call_handler(endpoints.get_task, request)


def bind_tasks_service(
    target: _runtime.BindTarget,
    *,
    handlers: TasksServiceHandlerFactories,
    app: _runtime.App | None = None,
    authenticate: _abc.Mapping[str, _runtime.Factory[_hooks.AuthenticateHook]] | None = None,
    deciders: _abc.Mapping[str, _runtime.Factory[_hooks.DecideHook]] | None = None,
    scope_resolvers: _abc.Mapping[str, _runtime.Factory[_hooks.ResolveScopeHook]] | None = None,
    idempotency_store: _runtime.Factory[_hooks.IdempotencyStore] | None = None,
    on_unexpected_error: _runtime.Factory[TasksServiceUnexpectedErrorListener] | None = None,
    responses: _runtime.ResponsesMode | None = None,
    body_validation: bool | None = None,
    operations: _abc.Mapping[str, _runtime.OperationSettings] | None = None,
    public_origin: str | None = None,
) -> None:
    """Places api 'tasksService' in the app; call it last, after its own middleware and exception handlers."""
    binding = _runtime.api_binding(
        PLACEMENT,
        _contract.CONTRACT,
        target,
        app=app,
        hooks=_runtime.HookFactories(
            authenticate=authenticate or {},
            deciders=deciders or {},
            scope_resolvers=scope_resolvers or {},
            idempotency_store=idempotency_store,
            on_unexpected_error=on_unexpected_error,
        ),
        settings=_runtime.RunSettings(
            responses=responses,
            body_validation=body_validation,
            operations=operations or {},
            public_origin=public_origin,
        ),
    )

    _runtime.add_operation(
        binding,
        "getTask",
        handlers.internal,
        _call_get_task,
        _runtime.OperationTypes(request=GetTaskRequest, responses=((200, GetTaskResponse200),), errors=GetTaskErrors),
    )

    _runtime.bind_api(binding)
