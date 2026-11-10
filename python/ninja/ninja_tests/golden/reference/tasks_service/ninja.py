"""The Django Ninja placement of api 'tasksService'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import django.http as _http
import ninja as _ninja

import seampact.hooks as _hooks
import seampact.ninja.runtime as _runtime

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
            "/internal/v1/channels/{path_channel_id}/tasks/{path_task_id}",
            ("GET", "HEAD"),
        ),
    ),
    error_base=TasksServiceContractError,
    views=_runtime.ViewsMode.ASYNC,
    credentials={
        "service": _runtime.CredentialsType(ServiceCredentials, {"internalToken": "internal_token"}),
    },
)


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class TasksServiceHandlerFactories:
    """Builds each endpoints protocol's handlers from the HttpRequest; None fails the boot."""

    internal: _runtime.Factory[InternalEndpoints] | None


class TasksServiceUnexpectedErrorListener(_hooks.UnexpectedErrorListener, _typing.Protocol):
    """Hears of each failure api 'tasksService' answers with its 500."""


async def _call_get_task(endpoints: InternalEndpoints, request: GetTaskRequest) -> GetTaskResult:
    return await _runtime.call_handler_async(endpoints.get_task, request)


async def _view_get_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return await _runtime.serve_operation_async(request, PLACEMENT, "getTask")


def bind_tasks_service(
    api: _ninja.NinjaAPI,
    *,
    prefix: str,
    handlers: TasksServiceHandlerFactories,
    authenticate: _abc.Mapping[str, _runtime.Factory[_hooks.AuthenticateHook]] | None = None,
    deciders: _abc.Mapping[str, _runtime.Factory[_hooks.DecideHook]] | None = None,
    scope_resolvers: _abc.Mapping[str, _runtime.Factory[_hooks.ResolveScopeHook]] | None = None,
    idempotency_store: _runtime.Factory[_hooks.IdempotencyStore] | None = None,
    on_unexpected_error: _runtime.Factory[TasksServiceUnexpectedErrorListener] | None = None,
    access: _abc.Mapping[str, _runtime.AccessSettings] | None = None,
    responses: _runtime.ResponsesMode | None = None,
    body_validation: bool | None = None,
    operations: _abc.Mapping[str, _runtime.OperationSettings] | None = None,
    public_origin: str | None = None,
) -> None:
    """Adds the api's Router to `api`; the URLconf prefix of `api.urls` plus `prefix` must equal the entry's mount."""
    binding = _runtime.api_binding(
        PLACEMENT,
        _contract.CONTRACT,
        api,
        prefix=prefix,
        authenticate=authenticate or {},
        deciders=deciders or {},
        scope_resolvers=scope_resolvers or {},
        idempotency_store=idempotency_store,
        on_unexpected_error=on_unexpected_error,
        access=access or {},
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
        _view_get_task,
        handlers.internal,
        _call_get_task,
        _runtime.OperationTypes(request=GetTaskRequest, responses=((200, GetTaskResponse200),), errors=GetTaskErrors),
    )

    _runtime.bind_api(binding)
