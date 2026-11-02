"""The FastAPI placement of api 'tasks'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import seampact.fastapi.runtime as _runtime
import seampact.hooks as _hooks

from . import contract as _contract
from .operations import (
    AppEndpoints,
    ArchiveTaskErrors,
    ArchiveTaskRequest,
    ArchiveTaskResponse200,
    ArchiveTaskResult,
    AssignTaskErrors,
    AssignTaskRequest,
    AssignTaskResponse200,
    AssignTaskResult,
    ChannelsEndpoints,
    CreateTaskErrors,
    CreateTaskRequest,
    CreateTaskResponse201,
    CreateTaskResult,
    DeleteDraftErrors,
    DeleteDraftRequest,
    DeleteDraftResponse200,
    DeleteDraftResult,
    DraftsEndpoints,
    GetChannelErrors,
    GetChannelRequest,
    GetChannelResponse200,
    GetChannelResult,
    GetDraftErrors,
    GetDraftRequest,
    GetDraftResponse200,
    GetDraftResult,
    GetPreferencesErrors,
    GetPreferencesRequest,
    GetPreferencesResponse200,
    GetPreferencesResponse304,
    GetPreferencesResult,
    GetTaskErrors,
    GetTaskRequest,
    GetTaskResponse200,
    GetTaskResult,
    GetTasksBatchErrors,
    GetTasksBatchRequest,
    GetTasksBatchResponse200,
    GetTasksBatchResult,
    HealthErrors,
    HealthRequest,
    HealthResponse200,
    HealthResult,
    HooksEndpoints,
    ListChannelsErrors,
    ListChannelsRequest,
    ListChannelsResponse200,
    ListChannelsResult,
    ListTasksErrors,
    ListTasksRequest,
    ListTasksResponse200,
    ListTasksResult,
    PaymentsErrors,
    PaymentsRequest,
    PaymentsResponse204,
    PaymentsResult,
    PreferencesEndpoints,
    PurgeTaskErrors,
    PurgeTaskRequest,
    PurgeTaskResponse204,
    PurgeTaskResult,
    SearchTasksErrors,
    SearchTasksRequest,
    SearchTasksResponse200,
    SearchTasksResult,
    TasksContractError,
    TasksEndpoints,
    UpdatePreferencesErrors,
    UpdatePreferencesRequest,
    UpdatePreferencesResponse200,
    UpdatePreferencesResult,
    UpdateTaskErrors,
    UpdateTaskRequest,
    UpdateTaskResponse200,
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
    """The FastAPI dependency that builds each endpoints protocol's handlers; None fails the boot."""

    tasks: _runtime.Factory[TasksEndpoints] | None
    drafts: _runtime.Factory[DraftsEndpoints] | None
    channels: _runtime.Factory[ChannelsEndpoints] | None
    preferences: _runtime.Factory[PreferencesEndpoints] | None
    app: _runtime.Factory[AppEndpoints] | None
    hooks: _runtime.Factory[HooksEndpoints] | None


async def _call_archive_task(endpoints: TasksEndpoints, request: ArchiveTaskRequest) -> ArchiveTaskResult:
    return await _runtime.call_handler(endpoints.archive_task, request)


async def _call_assign_task(endpoints: TasksEndpoints, request: AssignTaskRequest) -> AssignTaskResult:
    return await _runtime.call_handler(endpoints.assign_task, request)


async def _call_create_task(endpoints: TasksEndpoints, request: CreateTaskRequest) -> CreateTaskResult:
    return await _runtime.call_handler(endpoints.create_task, request)


async def _call_delete_draft(endpoints: DraftsEndpoints, request: DeleteDraftRequest) -> DeleteDraftResult:
    return await _runtime.call_handler(endpoints.delete_draft, request)


async def _call_get_channel(endpoints: ChannelsEndpoints, request: GetChannelRequest) -> GetChannelResult:
    return await _runtime.call_handler(endpoints.get_channel, request)


async def _call_get_draft(endpoints: DraftsEndpoints, request: GetDraftRequest) -> GetDraftResult:
    return await _runtime.call_handler(endpoints.get_draft, request)


async def _call_get_preferences(
    endpoints: PreferencesEndpoints, request: GetPreferencesRequest
) -> GetPreferencesResult:
    return await _runtime.call_handler(endpoints.get_preferences, request)


async def _call_get_task(endpoints: TasksEndpoints, request: GetTaskRequest) -> GetTaskResult:
    return await _runtime.call_handler(endpoints.get_task, request)


async def _call_get_tasks_batch(endpoints: TasksEndpoints, request: GetTasksBatchRequest) -> GetTasksBatchResult:
    return await _runtime.call_handler(endpoints.get_tasks_batch, request)


async def _call_health(endpoints: AppEndpoints, request: HealthRequest) -> HealthResult:
    return await _runtime.call_handler(endpoints.health, request)


async def _call_list_channels(endpoints: ChannelsEndpoints, request: ListChannelsRequest) -> ListChannelsResult:
    return await _runtime.call_handler(endpoints.list_channels, request)


async def _call_list_tasks(endpoints: TasksEndpoints, request: ListTasksRequest) -> ListTasksResult:
    return await _runtime.call_handler(endpoints.list_tasks, request)


async def _call_payments(endpoints: HooksEndpoints, request: PaymentsRequest) -> PaymentsResult:
    return await _runtime.call_handler(endpoints.payments, request)


async def _call_purge_task(endpoints: TasksEndpoints, request: PurgeTaskRequest) -> PurgeTaskResult:
    return await _runtime.call_handler(endpoints.purge_task, request)


async def _call_search_tasks(endpoints: TasksEndpoints, request: SearchTasksRequest) -> SearchTasksResult:
    return await _runtime.call_handler(endpoints.search_tasks, request)


async def _call_update_preferences(
    endpoints: PreferencesEndpoints, request: UpdatePreferencesRequest
) -> UpdatePreferencesResult:
    return await _runtime.call_handler(endpoints.update_preferences, request)


async def _call_update_task(endpoints: TasksEndpoints, request: UpdateTaskRequest) -> UpdateTaskResult:
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
    on_unexpected_error: _runtime.Factory[_hooks.UnexpectedErrorListener] | None = None,
    responses: _runtime.ResponsesMode | None = None,
    body_validation: bool | None = None,
    operations: _abc.Mapping[str, _runtime.OperationSettings] | None = None,
    public_origin: str | None = None,
) -> None:
    """Places api 'tasks' in the app; call it last, after its own middleware and exception handlers."""
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
        "health",
        handlers.app,
        _call_health,
        _runtime.OperationTypes(request=HealthRequest, responses=((200, HealthResponse200),), errors=HealthErrors),
    )
    _runtime.add_operation(
        binding,
        "listChannels",
        handlers.channels,
        _call_list_channels,
        _runtime.OperationTypes(
            request=ListChannelsRequest, responses=((200, ListChannelsResponse200),), errors=ListChannelsErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getPreferences",
        handlers.preferences,
        _call_get_preferences,
        _runtime.OperationTypes(
            request=GetPreferencesRequest,
            responses=((200, GetPreferencesResponse200), (304, GetPreferencesResponse304)),
            errors=GetPreferencesErrors,
        ),
    )
    _runtime.add_operation(
        binding,
        "payments",
        handlers.hooks,
        _call_payments,
        _runtime.OperationTypes(
            request=PaymentsRequest, responses=((204, PaymentsResponse204),), errors=PaymentsErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "updatePreferences",
        handlers.preferences,
        _call_update_preferences,
        _runtime.OperationTypes(
            request=UpdatePreferencesRequest,
            responses=((200, UpdatePreferencesResponse200),),
            errors=UpdatePreferencesErrors,
        ),
    )
    _runtime.add_operation(
        binding,
        "deleteDraft",
        handlers.drafts,
        _call_delete_draft,
        _runtime.OperationTypes(
            request=DeleteDraftRequest, responses=((200, DeleteDraftResponse200),), errors=DeleteDraftErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getDraft",
        handlers.drafts,
        _call_get_draft,
        _runtime.OperationTypes(
            request=GetDraftRequest, responses=((200, GetDraftResponse200),), errors=GetDraftErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getChannel",
        handlers.channels,
        _call_get_channel,
        _runtime.OperationTypes(
            request=GetChannelRequest, responses=((200, GetChannelResponse200),), errors=GetChannelErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "createTask",
        handlers.tasks,
        _call_create_task,
        _runtime.OperationTypes(
            request=CreateTaskRequest, responses=((201, CreateTaskResponse201),), errors=CreateTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "listTasks",
        handlers.tasks,
        _call_list_tasks,
        _runtime.OperationTypes(
            request=ListTasksRequest, responses=((200, ListTasksResponse200),), errors=ListTasksErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getTasksBatch",
        handlers.tasks,
        _call_get_tasks_batch,
        _runtime.OperationTypes(
            request=GetTasksBatchRequest, responses=((200, GetTasksBatchResponse200),), errors=GetTasksBatchErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "searchTasks",
        handlers.tasks,
        _call_search_tasks,
        _runtime.OperationTypes(
            request=SearchTasksRequest, responses=((200, SearchTasksResponse200),), errors=SearchTasksErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getTask",
        handlers.tasks,
        _call_get_task,
        _runtime.OperationTypes(request=GetTaskRequest, responses=((200, GetTaskResponse200),), errors=GetTaskErrors),
    )
    _runtime.add_operation(
        binding,
        "updateTask",
        handlers.tasks,
        _call_update_task,
        _runtime.OperationTypes(
            request=UpdateTaskRequest, responses=((200, UpdateTaskResponse200),), errors=UpdateTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "archiveTask",
        handlers.tasks,
        _call_archive_task,
        _runtime.OperationTypes(
            request=ArchiveTaskRequest, responses=((200, ArchiveTaskResponse200),), errors=ArchiveTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "assignTask",
        handlers.tasks,
        _call_assign_task,
        _runtime.OperationTypes(
            request=AssignTaskRequest, responses=((200, AssignTaskResponse200),), errors=AssignTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "purgeTask",
        handlers.tasks,
        _call_purge_task,
        _runtime.OperationTypes(
            request=PurgeTaskRequest, responses=((204, PurgeTaskResponse204),), errors=PurgeTaskErrors
        ),
    )

    _runtime.bind_api(binding)
