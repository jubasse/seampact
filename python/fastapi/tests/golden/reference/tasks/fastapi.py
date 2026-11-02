"""The FastAPI placement of api 'tasks'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import seampact.fastapi.runtime as _runtime
import seampact.hooks as _hooks

from . import (
    AppEndpoints,
    ArchiveTaskRequest,
    ArchiveTaskResult,
    AssignTaskRequest,
    AssignTaskResult,
    ChannelsEndpoints,
    CreateTaskRequest,
    CreateTaskResult,
    DeleteDraftRequest,
    DeleteDraftResult,
    DraftsEndpoints,
    GetChannelRequest,
    GetChannelResult,
    GetDraftRequest,
    GetDraftResult,
    GetPreferencesRequest,
    GetPreferencesResult,
    GetTaskRequest,
    GetTaskResult,
    GetTasksBatchRequest,
    GetTasksBatchResult,
    HealthRequest,
    HealthResult,
    HooksEndpoints,
    ListChannelsRequest,
    ListChannelsResult,
    ListTasksRequest,
    ListTasksResult,
    PaymentsRequest,
    PaymentsResult,
    PreferencesEndpoints,
    PurgeTaskRequest,
    PurgeTaskResult,
    SearchTasksRequest,
    SearchTasksResult,
    TasksContractError,
    TasksEndpoints,
    UpdatePreferencesRequest,
    UpdatePreferencesResult,
    UpdateTaskRequest,
    UpdateTaskResult,
)

GENERATED_BY: _typing.Final = "0.0.0-dev"


PLACEMENT: _typing.Final = _runtime.ApiPlacement(
    api="tasks",
    generated_by=GENERATED_BY,
    mount="",
    routes=(
        _runtime.OperationRoute("health", "seampact.tasks.health", "/v1/health", ("GET", "HEAD")),
        _runtime.OperationRoute("listChannels", "seampact.tasks.listChannels", "/v1/channels", ("GET", "HEAD")),
        _runtime.OperationRoute(
            "getPreferences", "seampact.tasks.getPreferences", "/v1/me/preferences", ("GET", "HEAD")
        ),
        _runtime.OperationRoute("payments", "seampact.tasks.payments", "/v1/hooks/payments", ("POST",)),
        _runtime.OperationRoute(
            "updatePreferences", "seampact.tasks.updatePreferences", "/v1/me/preferences", ("PATCH",)
        ),
        _runtime.OperationRoute("deleteDraft", "seampact.tasks.deleteDraft", "/v1/me/drafts/{draft_id}", ("DELETE",)),
        _runtime.OperationRoute("getDraft", "seampact.tasks.getDraft", "/v1/me/drafts/{draft_id}", ("GET", "HEAD")),
        _runtime.OperationRoute(
            "getChannel", "seampact.tasks.getChannel", "/v1/channels/{channel_id}", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "createTask", "seampact.tasks.createTask", "/v1/channels/{channel_id}/tasks", ("POST",)
        ),
        _runtime.OperationRoute(
            "listTasks", "seampact.tasks.listTasks", "/v1/channels/{channel_id}/tasks", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "getTasksBatch", "seampact.tasks.getTasksBatch", "/v1/channels/{channel_id}/tasks/batch", ("POST",)
        ),
        _runtime.OperationRoute(
            "searchTasks", "seampact.tasks.searchTasks", "/v1/channels/{channel_id}/tasks/search", ("POST",)
        ),
        _runtime.OperationRoute(
            "getTask", "seampact.tasks.getTask", "/v1/channels/{channel_id}/tasks/{task_id}", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "updateTask", "seampact.tasks.updateTask", "/v1/channels/{channel_id}/tasks/{task_id}", ("PATCH",)
        ),
        _runtime.OperationRoute(
            "archiveTask", "seampact.tasks.archiveTask", "/v1/channels/{channel_id}/tasks/{task_id}/archive", ("POST",)
        ),
        _runtime.OperationRoute(
            "assignTask", "seampact.tasks.assignTask", "/v1/channels/{channel_id}/tasks/{task_id}/assign", ("POST",)
        ),
        _runtime.OperationRoute(
            "purgeTask", "seampact.tasks.purgeTask", "/v1/channels/{channel_id}/tasks/{task_id}/purge", ("POST",)
        ),
    ),
    error_base=TasksContractError,
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
)


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class TasksHandlerFactories:
    """The FastAPI dependency that builds the handlers of each endpoints protocol."""

    tasks: _runtime.Factory[TasksEndpoints]
    drafts: _runtime.Factory[DraftsEndpoints]
    channels: _runtime.Factory[ChannelsEndpoints]
    preferences: _runtime.Factory[PreferencesEndpoints]
    app: _runtime.Factory[AppEndpoints]
    hooks: _runtime.Factory[HooksEndpoints]


async def _archive_task(endpoints: TasksEndpoints, request: ArchiveTaskRequest) -> ArchiveTaskResult:
    return await _runtime.call_handler(endpoints.archive_task, request)


async def _assign_task(endpoints: TasksEndpoints, request: AssignTaskRequest) -> AssignTaskResult:
    return await _runtime.call_handler(endpoints.assign_task, request)


async def _create_task(endpoints: TasksEndpoints, request: CreateTaskRequest) -> CreateTaskResult:
    return await _runtime.call_handler(endpoints.create_task, request)


async def _delete_draft(endpoints: DraftsEndpoints, request: DeleteDraftRequest) -> DeleteDraftResult:
    return await _runtime.call_handler(endpoints.delete_draft, request)


async def _get_channel(endpoints: ChannelsEndpoints, request: GetChannelRequest) -> GetChannelResult:
    return await _runtime.call_handler(endpoints.get_channel, request)


async def _get_draft(endpoints: DraftsEndpoints, request: GetDraftRequest) -> GetDraftResult:
    return await _runtime.call_handler(endpoints.get_draft, request)


async def _get_preferences(endpoints: PreferencesEndpoints, request: GetPreferencesRequest) -> GetPreferencesResult:
    return await _runtime.call_handler(endpoints.get_preferences, request)


async def _get_task(endpoints: TasksEndpoints, request: GetTaskRequest) -> GetTaskResult:
    return await _runtime.call_handler(endpoints.get_task, request)


async def _get_tasks_batch(endpoints: TasksEndpoints, request: GetTasksBatchRequest) -> GetTasksBatchResult:
    return await _runtime.call_handler(endpoints.get_tasks_batch, request)


async def _health(endpoints: AppEndpoints, request: HealthRequest) -> HealthResult:
    return await _runtime.call_handler(endpoints.health, request)


async def _list_channels(endpoints: ChannelsEndpoints, request: ListChannelsRequest) -> ListChannelsResult:
    return await _runtime.call_handler(endpoints.list_channels, request)


async def _list_tasks(endpoints: TasksEndpoints, request: ListTasksRequest) -> ListTasksResult:
    return await _runtime.call_handler(endpoints.list_tasks, request)


async def _payments(endpoints: HooksEndpoints, request: PaymentsRequest) -> PaymentsResult:
    return await _runtime.call_handler(endpoints.payments, request)


async def _purge_task(endpoints: TasksEndpoints, request: PurgeTaskRequest) -> PurgeTaskResult:
    return await _runtime.call_handler(endpoints.purge_task, request)


async def _search_tasks(endpoints: TasksEndpoints, request: SearchTasksRequest) -> SearchTasksResult:
    return await _runtime.call_handler(endpoints.search_tasks, request)


async def _update_preferences(
    endpoints: PreferencesEndpoints, request: UpdatePreferencesRequest
) -> UpdatePreferencesResult:
    return await _runtime.call_handler(endpoints.update_preferences, request)


async def _update_task(endpoints: TasksEndpoints, request: UpdateTaskRequest) -> UpdateTaskResult:
    return await _runtime.call_handler(endpoints.update_task, request)


def bind_tasks(
    target: _runtime.BindTarget,
    *,
    handlers: TasksHandlerFactories,
    app: _runtime.App | None = None,
    authenticate: _abc.Mapping[str, _runtime.Factory[_hooks.AuthenticateHook]] | None = None,
    deciders: _abc.Mapping[str, _runtime.Factory[_hooks.DecideHook]] | None = None,
    scope_resolvers: _abc.Mapping[str, _runtime.Factory[_hooks.ResolveScopeHook]] | None = None,
    idempotency_store: _runtime.Factory[_hooks.IdempotencyStore] | None = None,
    on_unexpected_error: _runtime.Factory[object] | None = None,
    responses: _runtime.ResponsesMode | None = None,
    body_validation: bool | None = None,
    operations: _abc.Mapping[str, _runtime.OperationSettings] | None = None,
    public_origin: str | None = None,
) -> None:
    """Places api 'tasks' in the app; call it last, after its own middleware and exception handlers."""
    router = _runtime.contract_router()

    _runtime.add_operation(router, PLACEMENT, "health", handlers.app, _health)
    _runtime.add_operation(router, PLACEMENT, "listChannels", handlers.channels, _list_channels)
    _runtime.add_operation(router, PLACEMENT, "getPreferences", handlers.preferences, _get_preferences)
    _runtime.add_operation(router, PLACEMENT, "payments", handlers.hooks, _payments)
    _runtime.add_operation(router, PLACEMENT, "updatePreferences", handlers.preferences, _update_preferences)
    _runtime.add_operation(router, PLACEMENT, "deleteDraft", handlers.drafts, _delete_draft)
    _runtime.add_operation(router, PLACEMENT, "getDraft", handlers.drafts, _get_draft)
    _runtime.add_operation(router, PLACEMENT, "getChannel", handlers.channels, _get_channel)
    _runtime.add_operation(router, PLACEMENT, "createTask", handlers.tasks, _create_task)
    _runtime.add_operation(router, PLACEMENT, "listTasks", handlers.tasks, _list_tasks)
    _runtime.add_operation(router, PLACEMENT, "getTasksBatch", handlers.tasks, _get_tasks_batch)
    _runtime.add_operation(router, PLACEMENT, "searchTasks", handlers.tasks, _search_tasks)
    _runtime.add_operation(router, PLACEMENT, "getTask", handlers.tasks, _get_task)
    _runtime.add_operation(router, PLACEMENT, "updateTask", handlers.tasks, _update_task)
    _runtime.add_operation(router, PLACEMENT, "archiveTask", handlers.tasks, _archive_task)
    _runtime.add_operation(router, PLACEMENT, "assignTask", handlers.tasks, _assign_task)
    _runtime.add_operation(router, PLACEMENT, "purgeTask", handlers.tasks, _purge_task)

    _runtime.bind_api(
        PLACEMENT,
        target,
        router,
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
