"""The Django Ninja placement of api 'tasks'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import django.http as _http
import ninja as _ninja

import seampact.hooks as _hooks
import seampact.ninja.runtime as _runtime

from . import contract as _contract
from . import schemas as _schemas
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
    StripeCredentials,
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
    UserCredentials,
)

GENERATED_BY: _typing.Final = "1.0.1"


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
        _runtime.OperationRoute("updatePreferences", "seampact.tasks.getPreferences", "/v1/me/preferences", ("PATCH",)),
        _runtime.OperationRoute("payments", "seampact.tasks.payments", "/v1/hooks/payments", ("POST",)),
        _runtime.OperationRoute(
            "deleteDraft", "seampact.tasks.deleteDraft", "/v1/me/drafts/{path_draft_id}", ("DELETE",)
        ),
        _runtime.OperationRoute(
            "getDraft", "seampact.tasks.deleteDraft", "/v1/me/drafts/{path_draft_id}", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "getChannel", "seampact.tasks.getChannel", "/v1/channels/{path_channel_id}", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "createTask", "seampact.tasks.createTask", "/v1/channels/{path_channel_id}/tasks", ("POST",)
        ),
        _runtime.OperationRoute(
            "listTasks", "seampact.tasks.createTask", "/v1/channels/{path_channel_id}/tasks", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "getTasksBatch", "seampact.tasks.getTasksBatch", "/v1/channels/{path_channel_id}/tasks/batch", ("POST",)
        ),
        _runtime.OperationRoute(
            "searchTasks", "seampact.tasks.searchTasks", "/v1/channels/{path_channel_id}/tasks/search", ("POST",)
        ),
        _runtime.OperationRoute(
            "getTask", "seampact.tasks.getTask", "/v1/channels/{path_channel_id}/tasks/{path_task_id}", ("GET", "HEAD")
        ),
        _runtime.OperationRoute(
            "updateTask", "seampact.tasks.getTask", "/v1/channels/{path_channel_id}/tasks/{path_task_id}", ("PATCH",)
        ),
        _runtime.OperationRoute(
            "archiveTask",
            "seampact.tasks.archiveTask",
            "/v1/channels/{path_channel_id}/tasks/{path_task_id}/archive",
            ("POST",),
        ),
        _runtime.OperationRoute(
            "assignTask",
            "seampact.tasks.assignTask",
            "/v1/channels/{path_channel_id}/tasks/{path_task_id}/assign",
            ("POST",),
        ),
        _runtime.OperationRoute(
            "purgeTask",
            "seampact.tasks.purgeTask",
            "/v1/channels/{path_channel_id}/tasks/{path_task_id}/purge",
            ("POST",),
        ),
    ),
    error_base=TasksContractError,
    views=_runtime.ViewsMode.SYNC,
    credentials={
        "stripe": _runtime.CredentialsType(StripeCredentials, {"stripeSignature": "stripe_signature"}),
        "user": _runtime.CredentialsType(UserCredentials, {"bearer": "bearer", "sessionCookie": "session_cookie"}),
    },
)


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class TasksHandlerFactories:
    """Builds each endpoints protocol's handlers from the HttpRequest; None fails the boot."""

    tasks: _runtime.Factory[TasksEndpoints] | None
    drafts: _runtime.Factory[DraftsEndpoints] | None
    channels: _runtime.Factory[ChannelsEndpoints] | None
    preferences: _runtime.Factory[PreferencesEndpoints] | None
    app: _runtime.Factory[AppEndpoints] | None
    hooks: _runtime.Factory[HooksEndpoints] | None


class TasksUnexpectedErrorListener(_hooks.UnexpectedErrorListener, _typing.Protocol):
    """Hears of each failure api 'tasks' answers with its 500."""


def _call_archive_task(endpoints: TasksEndpoints, request: ArchiveTaskRequest) -> ArchiveTaskResult:
    result = endpoints.archive_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.archive_task, result)

    return result


def _call_assign_task(endpoints: TasksEndpoints, request: AssignTaskRequest) -> AssignTaskResult:
    result = endpoints.assign_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.assign_task, result)

    return result


def _call_create_task(endpoints: TasksEndpoints, request: CreateTaskRequest) -> CreateTaskResult:
    result = endpoints.create_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.create_task, result)

    return result


def _call_delete_draft(endpoints: DraftsEndpoints, request: DeleteDraftRequest) -> DeleteDraftResult:
    result = endpoints.delete_draft(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.delete_draft, result)

    return result


def _call_get_channel(endpoints: ChannelsEndpoints, request: GetChannelRequest) -> GetChannelResult:
    result = endpoints.get_channel(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.get_channel, result)

    return result


def _call_get_draft(endpoints: DraftsEndpoints, request: GetDraftRequest) -> GetDraftResult:
    result = endpoints.get_draft(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.get_draft, result)

    return result


def _call_get_preferences(endpoints: PreferencesEndpoints, request: GetPreferencesRequest) -> GetPreferencesResult:
    result = endpoints.get_preferences(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.get_preferences, result)

    return result


def _call_get_task(endpoints: TasksEndpoints, request: GetTaskRequest) -> GetTaskResult:
    result = endpoints.get_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.get_task, result)

    return result


def _call_get_tasks_batch(endpoints: TasksEndpoints, request: GetTasksBatchRequest) -> GetTasksBatchResult:
    result = endpoints.get_tasks_batch(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.get_tasks_batch, result)

    return result


def _call_health(endpoints: AppEndpoints, request: HealthRequest) -> HealthResult:
    result = endpoints.health(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.health, result)

    return result


def _call_list_channels(endpoints: ChannelsEndpoints, request: ListChannelsRequest) -> ListChannelsResult:
    result = endpoints.list_channels(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.list_channels, result)

    return result


def _call_list_tasks(endpoints: TasksEndpoints, request: ListTasksRequest) -> ListTasksResult:
    result = endpoints.list_tasks(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.list_tasks, result)

    return result


def _call_payments(endpoints: HooksEndpoints, request: PaymentsRequest) -> PaymentsResult:
    result = endpoints.payments(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.payments, result)

    return result


def _call_purge_task(endpoints: TasksEndpoints, request: PurgeTaskRequest) -> PurgeTaskResult:
    result = endpoints.purge_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.purge_task, result)

    return result


def _call_search_tasks(endpoints: TasksEndpoints, request: SearchTasksRequest) -> SearchTasksResult:
    result = endpoints.search_tasks(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.search_tasks, result)

    return result


def _call_update_preferences(
    endpoints: PreferencesEndpoints, request: UpdatePreferencesRequest
) -> UpdatePreferencesResult:
    result = endpoints.update_preferences(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.update_preferences, result)

    return result


def _call_update_task(endpoints: TasksEndpoints, request: UpdateTaskRequest) -> UpdateTaskResult:
    result = endpoints.update_task(request)

    if isinstance(result, _abc.Awaitable):
        raise _runtime.async_handler_error(endpoints.update_task, result)

    return result


def _view_health(request: _http.HttpRequest) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "health")


def _view_list_channels(request: _http.HttpRequest) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "listChannels")


def _view_get_preferences(request: _http.HttpRequest) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "getPreferences")


def _view_update_preferences(request: _http.HttpRequest) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "updatePreferences")


def _view_payments(request: _http.HttpRequest) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "payments")


def _view_delete_draft(request: _http.HttpRequest, path_draft_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "deleteDraft")


def _view_get_draft(request: _http.HttpRequest, path_draft_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "getDraft")


def _view_get_channel(request: _http.HttpRequest, path_channel_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "getChannel")


def _view_create_task(request: _http.HttpRequest, path_channel_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "createTask")


def _view_list_tasks(request: _http.HttpRequest, path_channel_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "listTasks")


def _view_get_tasks_batch(request: _http.HttpRequest, path_channel_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "getTasksBatch")


def _view_search_tasks(request: _http.HttpRequest, path_channel_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "searchTasks")


def _view_get_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "getTask")


def _view_update_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "updateTask")


def _view_archive_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "archiveTask")


def _view_assign_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "assignTask")


def _view_purge_task(request: _http.HttpRequest, path_channel_id: str, path_task_id: str) -> _http.HttpResponse:
    return _runtime.serve_operation(request, PLACEMENT, "purgeTask")


def bind_tasks(
    api: _ninja.NinjaAPI,
    *,
    prefix: str,
    handlers: TasksHandlerFactories,
    authenticate: _abc.Mapping[str, _runtime.Factory[_hooks.AuthenticateHook]] | None = None,
    deciders: _abc.Mapping[str, _runtime.Factory[_hooks.DecideHook]] | None = None,
    scope_resolvers: _abc.Mapping[str, _runtime.Factory[_hooks.ResolveScopeHook]] | None = None,
    idempotency_store: _runtime.Factory[_hooks.IdempotencyStore] | None = None,
    on_unexpected_error: _runtime.Factory[TasksUnexpectedErrorListener] | None = None,
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
        "health",
        _view_health,
        handlers.app,
        _call_health,
        _runtime.OperationTypes(request=HealthRequest, responses=((200, HealthResponse200),), errors=HealthErrors),
    )
    _runtime.add_operation(
        binding,
        "listChannels",
        _view_list_channels,
        handlers.channels,
        _call_list_channels,
        _runtime.OperationTypes(
            request=ListChannelsRequest, responses=((200, ListChannelsResponse200),), errors=ListChannelsErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getPreferences",
        _view_get_preferences,
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
        "updatePreferences",
        _view_update_preferences,
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
        "payments",
        _view_payments,
        handlers.hooks,
        _call_payments,
        _runtime.OperationTypes(
            request=PaymentsRequest, responses=((204, PaymentsResponse204),), errors=PaymentsErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "deleteDraft",
        _view_delete_draft,
        handlers.drafts,
        _call_delete_draft,
        _runtime.OperationTypes(
            request=DeleteDraftRequest, responses=((200, DeleteDraftResponse200),), errors=DeleteDraftErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getDraft",
        _view_get_draft,
        handlers.drafts,
        _call_get_draft,
        _runtime.OperationTypes(
            request=GetDraftRequest, responses=((200, GetDraftResponse200),), errors=GetDraftErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getChannel",
        _view_get_channel,
        handlers.channels,
        _call_get_channel,
        _runtime.OperationTypes(
            request=GetChannelRequest, responses=((200, GetChannelResponse200),), errors=GetChannelErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "createTask",
        _view_create_task,
        handlers.tasks,
        _call_create_task,
        _runtime.OperationTypes(
            request=CreateTaskRequest, responses=((201, CreateTaskResponse201),), errors=CreateTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "listTasks",
        _view_list_tasks,
        handlers.tasks,
        _call_list_tasks,
        _runtime.OperationTypes(
            request=ListTasksRequest, responses=((200, ListTasksResponse200),), errors=ListTasksErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getTasksBatch",
        _view_get_tasks_batch,
        handlers.tasks,
        _call_get_tasks_batch,
        _runtime.OperationTypes(
            request=GetTasksBatchRequest, responses=((200, GetTasksBatchResponse200),), errors=GetTasksBatchErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "searchTasks",
        _view_search_tasks,
        handlers.tasks,
        _call_search_tasks,
        _runtime.OperationTypes(
            request=SearchTasksRequest, responses=((200, SearchTasksResponse200),), errors=SearchTasksErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "getTask",
        _view_get_task,
        handlers.tasks,
        _call_get_task,
        _runtime.OperationTypes(request=GetTaskRequest, responses=((200, GetTaskResponse200),), errors=GetTaskErrors),
    )
    _runtime.add_operation(
        binding,
        "updateTask",
        _view_update_task,
        handlers.tasks,
        _call_update_task,
        _runtime.OperationTypes(
            request=UpdateTaskRequest, responses=((200, UpdateTaskResponse200),), errors=UpdateTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "archiveTask",
        _view_archive_task,
        handlers.tasks,
        _call_archive_task,
        _runtime.OperationTypes(
            request=ArchiveTaskRequest, responses=((200, ArchiveTaskResponse200),), errors=ArchiveTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "assignTask",
        _view_assign_task,
        handlers.tasks,
        _call_assign_task,
        _runtime.OperationTypes(
            request=AssignTaskRequest, responses=((200, AssignTaskResponse200),), errors=AssignTaskErrors
        ),
    )
    _runtime.add_operation(
        binding,
        "purgeTask",
        _view_purge_task,
        handlers.tasks,
        _call_purge_task,
        _runtime.OperationTypes(
            request=PurgeTaskRequest,
            responses=((204, PurgeTaskResponse204),),
            errors=PurgeTaskErrors,
            proofs=_schemas.PurgeTaskProofs,
        ),
    )

    _runtime.bind_api(binding)
