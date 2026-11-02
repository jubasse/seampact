"""The operation types of api 'tasks'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import pydantic as _pydantic

import seampact.hooks as _hooks

from . import schemas as _schemas


class TasksContractError(Exception):
    """A declared error of api 'tasks', raised by a handler."""

    CODE: _typing.ClassVar[str]
    STATUS: _typing.ClassVar[int]

    def __init__(self, params: _pydantic.BaseModel | None = None) -> None:
        super().__init__(f"The declared error {self.CODE!r} of api 'tasks'.")
        self.params = params


class ApiCsrfInvalidError(TasksContractError):
    """The error 'api.csrf_invalid'."""

    CODE = "api.csrf_invalid"
    STATUS = 403


class ApiForbiddenError(TasksContractError):
    """The error 'api.forbidden'."""

    CODE = "api.forbidden"
    STATUS = 403

    def __init__(self, params: _schemas.ApiForbiddenParams) -> None:
        super().__init__(params)


class ApiIdempotencyInProgressError(TasksContractError):
    """The error 'api.idempotency_in_progress'."""

    CODE = "api.idempotency_in_progress"
    STATUS = 409


class ApiIdempotencyKeyReusedError(TasksContractError):
    """The error 'api.idempotency_key_reused'."""

    CODE = "api.idempotency_key_reused"
    STATUS = 422


class ApiInternalError(TasksContractError):
    """The error 'api.internal'."""

    CODE = "api.internal"
    STATUS = 500


class ApiNotFoundError(TasksContractError):
    """The error 'api.not_found'."""

    CODE = "api.not_found"
    STATUS = 404


class ApiPayloadTooLargeError(TasksContractError):
    """The error 'api.payload_too_large'."""

    CODE = "api.payload_too_large"
    STATUS = 413

    def __init__(self, params: _schemas.ApiPayloadTooLargeParams) -> None:
        super().__init__(params)


class ApiRateLimitedError(TasksContractError):
    """The error 'api.rate_limited'."""

    CODE = "api.rate_limited"
    STATUS = 429

    def __init__(self, params: _schemas.ApiRateLimitedParams) -> None:
        super().__init__(params)


class ApiReauthenticationRequiredError(TasksContractError):
    """The error 'api.reauthentication_required'."""

    CODE = "api.reauthentication_required"
    STATUS = 401


class ApiSchemaInvalidError(TasksContractError):
    """The error 'api.schema_invalid'."""

    CODE = "api.schema_invalid"
    STATUS = 400

    def __init__(self, params: _schemas.ApiSchemaInvalidParams) -> None:
        super().__init__(params)


class ApiUnauthenticatedError(TasksContractError):
    """The error 'api.unauthenticated'."""

    CODE = "api.unauthenticated"
    STATUS = 401


class ApiUnsupportedMediaTypeError(TasksContractError):
    """The error 'api.unsupported_media_type'."""

    CODE = "api.unsupported_media_type"
    STATUS = 415


class StateConflictError(TasksContractError):
    """The error 'state.conflict'."""

    CODE = "state.conflict"
    STATUS = 409


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskScopes:
    """The scopes operation 'archiveTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskInput:
    """The input of operation 'archiveTask', as its handler reads it."""

    path: _schemas.ArchiveTaskPath
    headers: _schemas.ArchiveTaskHeaders
    body: _schemas.ArchiveTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskRequest:
    """What the handler of operation 'archiveTask' reads: its input and who is calling."""

    input: ArchiveTaskInput
    principal: _schemas.UserPrincipal
    scopes: ArchiveTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class ArchiveTaskResponse200:
    """The 200 reply of operation 'archiveTask'."""

    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True)
class ArchiveTaskErrors:
    """A declared error of operation 'archiveTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def state_conflict(cls) -> _typing.Self:
        return cls("state.conflict", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type ArchiveTaskResult = ArchiveTaskResponse200 | ArchiveTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskScopes:
    """The scopes operation 'assignTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskInput:
    """The input of operation 'assignTask', as its handler reads it."""

    path: _schemas.AssignTaskPath
    headers: _schemas.AssignTaskHeaders
    body: _schemas.AssignTaskInput


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskRequest:
    """What the handler of operation 'assignTask' reads: its input and who is calling."""

    input: AssignTaskInput
    principal: _schemas.UserPrincipal
    scopes: AssignTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class AssignTaskResponse200:
    """The 200 reply of operation 'assignTask'."""

    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True)
class AssignTaskErrors:
    """A declared error of operation 'assignTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls("api.forbidden", params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type AssignTaskResult = AssignTaskResponse200 | AssignTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskScopes:
    """The scopes operation 'createTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskInput:
    """The input of operation 'createTask', as its handler reads it."""

    path: _schemas.CreateTaskPath
    headers: _schemas.CreateTaskHeaders
    body: _schemas.CreateTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskRequest:
    """What the handler of operation 'createTask' reads: its input and who is calling."""

    input: CreateTaskInput
    principal: _schemas.UserPrincipal
    scopes: CreateTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class CreateTaskResponse201:
    """The 201 reply of operation 'createTask'."""

    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True)
class CreateTaskErrors:
    """A declared error of operation 'createTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls("api.forbidden", params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_rate_limited(cls, params: _schemas.ApiRateLimitedParams) -> _typing.Self:
        return cls("api.rate_limited", params)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type CreateTaskResult = CreateTaskResponse201 | CreateTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftInput:
    """The input of operation 'deleteDraft', as its handler reads it."""

    path: _schemas.DeleteDraftPath
    headers: _schemas.DeleteDraftHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftRequest:
    """What the handler of operation 'deleteDraft' reads: its input and who is calling."""

    input: DeleteDraftInput
    principal: _schemas.UserPrincipal


@_dataclasses.dataclass(frozen=True, slots=True)
class DeleteDraftResponse200:
    """The 200 reply of operation 'deleteDraft'."""

    body: _schemas.Draft


@_dataclasses.dataclass(frozen=True, slots=True)
class DeleteDraftErrors:
    """A declared error of operation 'deleteDraft', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type DeleteDraftResult = DeleteDraftResponse200 | DeleteDraftErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelScopes:
    """The scopes operation 'getChannel' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelInput:
    """The input of operation 'getChannel', as its handler reads it."""

    path: _schemas.GetChannelPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelRequest:
    """What the handler of operation 'getChannel' reads: its input and who is calling."""

    input: GetChannelInput
    principal: _schemas.UserPrincipal
    scopes: GetChannelScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class GetChannelResponse200:
    """The 200 reply of operation 'getChannel'."""

    body: _schemas.Channel


@_dataclasses.dataclass(frozen=True, slots=True)
class GetChannelErrors:
    """A declared error of operation 'getChannel', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type GetChannelResult = GetChannelResponse200 | GetChannelErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftInput:
    """The input of operation 'getDraft', as its handler reads it."""

    path: _schemas.GetDraftPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftRequest:
    """What the handler of operation 'getDraft' reads: its input and who is calling."""

    input: GetDraftInput
    principal: _schemas.UserPrincipal


@_dataclasses.dataclass(frozen=True, slots=True)
class GetDraftResponse200:
    """The 200 reply of operation 'getDraft'."""

    body: _schemas.Draft


@_dataclasses.dataclass(frozen=True, slots=True)
class GetDraftErrors:
    """A declared error of operation 'getDraft', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type GetDraftResult = GetDraftResponse200 | GetDraftErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesInput:
    """The input of operation 'getPreferences', as its handler reads it."""

    headers: _schemas.GetPreferencesHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesRequest:
    """What the handler of operation 'getPreferences' reads: its input and who is calling."""

    input: GetPreferencesInput
    principal: _schemas.UserPrincipal


@_dataclasses.dataclass(frozen=True, slots=True)
class GetPreferencesResponse200:
    """The 200 reply of operation 'getPreferences'."""

    body: _schemas.Preferences


@_dataclasses.dataclass(frozen=True, slots=True)
class GetPreferencesResponse304:
    """The 304 reply of operation 'getPreferences'."""


@_dataclasses.dataclass(frozen=True, slots=True)
class GetPreferencesErrors:
    """A declared error of operation 'getPreferences', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type GetPreferencesResult = GetPreferencesResponse200 | GetPreferencesResponse304 | GetPreferencesErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskScopes:
    """The scopes operation 'getTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskInput:
    """The input of operation 'getTask', as its handler reads it."""

    path: _schemas.GetTaskPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskRequest:
    """What the handler of operation 'getTask' reads: its input and who is calling."""

    input: GetTaskInput
    principal: _schemas.UserPrincipal
    scopes: GetTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class GetTaskResponse200:
    """The 200 reply of operation 'getTask'."""

    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True)
class GetTaskErrors:
    """A declared error of operation 'getTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type GetTaskResult = GetTaskResponse200 | GetTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchScopes:
    """The scopes operation 'getTasksBatch' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchInput:
    """The input of operation 'getTasksBatch', as its handler reads it."""

    path: _schemas.GetTasksBatchPath
    body: _schemas.GetTasksBatchInput


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchRequest:
    """What the handler of operation 'getTasksBatch' reads: its input and who is calling."""

    input: GetTasksBatchInput
    principal: _schemas.UserPrincipal
    scopes: GetTasksBatchScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class GetTasksBatchResponse200:
    """The 200 reply of operation 'getTasksBatch'."""

    body: dict[str, _schemas.Task]


@_dataclasses.dataclass(frozen=True, slots=True)
class GetTasksBatchErrors:
    """A declared error of operation 'getTasksBatch', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type GetTasksBatchResult = GetTasksBatchResponse200 | GetTasksBatchErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthInput:
    """The input of operation 'health', as its handler reads it."""


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthRequest:
    """What the handler of operation 'health' reads: its input and who is calling."""

    input: HealthInput


@_dataclasses.dataclass(frozen=True, slots=True)
class HealthResponse200:
    """The 200 reply of operation 'health'."""

    body: _schemas.Health


@_dataclasses.dataclass(frozen=True, slots=True)
class HealthErrors:
    """A declared error of operation 'health', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type HealthResult = HealthResponse200 | HealthErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsInput:
    """The input of operation 'listChannels', as its handler reads it."""

    query: _schemas.ListChannelsQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsRequest:
    """What the handler of operation 'listChannels' reads: its input and who is calling."""

    input: ListChannelsInput
    principal: _schemas.UserPrincipal


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsPage:
    """The page of operation 'listChannels': its items and the facts its paging style reads."""

    items: list[_schemas.Channel]
    next_cursor: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True)
class ListChannelsResponse200:
    """The 200 reply of operation 'listChannels'."""

    body: ListChannelsPage


@_dataclasses.dataclass(frozen=True, slots=True)
class ListChannelsErrors:
    """A declared error of operation 'listChannels', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type ListChannelsResult = ListChannelsResponse200 | ListChannelsErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksScopes:
    """The scopes operation 'listTasks' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksInput:
    """The input of operation 'listTasks', as its handler reads it."""

    path: _schemas.ListTasksPath
    query: _schemas.ListTasksQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksRequest:
    """What the handler of operation 'listTasks' reads: its input and who is calling."""

    input: ListTasksInput
    principal: _schemas.UserPrincipal
    scopes: ListTasksScopes


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksPage:
    """The page of operation 'listTasks': its items and the facts its paging style reads."""

    items: list[_schemas.Task]
    next_cursor: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True)
class ListTasksResponse200:
    """The 200 reply of operation 'listTasks'."""

    body: ListTasksPage


@_dataclasses.dataclass(frozen=True, slots=True)
class ListTasksErrors:
    """A declared error of operation 'listTasks', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type ListTasksResult = ListTasksResponse200 | ListTasksErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PaymentsInput:
    """The input of operation 'payments', as its handler reads it."""

    body: _schemas.PaymentEvent


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PaymentsRequest:
    """What the handler of operation 'payments' reads: its input and who is calling."""

    input: PaymentsInput
    principal: _schemas.WebhookCaller


@_dataclasses.dataclass(frozen=True, slots=True)
class PaymentsResponse204:
    """The 204 reply of operation 'payments'."""


@_dataclasses.dataclass(frozen=True, slots=True)
class PaymentsErrors:
    """A declared error of operation 'payments', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type PaymentsResult = PaymentsResponse204 | PaymentsErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskScopes:
    """The scopes operation 'purgeTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskInput:
    """The input of operation 'purgeTask', as its handler reads it."""

    path: _schemas.PurgeTaskPath
    headers: _schemas.PurgeTaskHeaders
    body: _schemas.ApiEmptyBody


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskRequest:
    """What the handler of operation 'purgeTask' reads: its input and who is calling."""

    input: PurgeTaskInput
    principal: _schemas.UserPrincipal
    scopes: PurgeTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class PurgeTaskResponse204:
    """The 204 reply of operation 'purgeTask'."""


@_dataclasses.dataclass(frozen=True, slots=True)
class PurgeTaskErrors:
    """A declared error of operation 'purgeTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_reauthentication_required(cls) -> _typing.Self:
        return cls("api.reauthentication_required", None)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type PurgeTaskResult = PurgeTaskResponse204 | PurgeTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksScopes:
    """The scopes operation 'searchTasks' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksInput:
    """The input of operation 'searchTasks', as its handler reads it."""

    path: _schemas.SearchTasksPath
    body: _schemas.TaskQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksRequest:
    """What the handler of operation 'searchTasks' reads: its input and who is calling."""

    input: SearchTasksInput
    principal: _schemas.UserPrincipal
    scopes: SearchTasksScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class SearchTasksResponse200:
    """The 200 reply of operation 'searchTasks'."""

    body: _schemas.TaskSearchResult


@_dataclasses.dataclass(frozen=True, slots=True)
class SearchTasksErrors:
    """A declared error of operation 'searchTasks', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls("api.forbidden", params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type SearchTasksResult = SearchTasksResponse200 | SearchTasksErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesInput:
    """The input of operation 'updatePreferences', as its handler reads it."""

    headers: _schemas.UpdatePreferencesHeaders
    body: _schemas.UpdatePreferences


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesRequest:
    """What the handler of operation 'updatePreferences' reads: its input and who is calling."""

    input: UpdatePreferencesInput
    principal: _schemas.UserPrincipal


@_dataclasses.dataclass(frozen=True, slots=True)
class UpdatePreferencesResponse200:
    """The 200 reply of operation 'updatePreferences'."""

    body: _schemas.Preferences


@_dataclasses.dataclass(frozen=True, slots=True)
class UpdatePreferencesErrors:
    """A declared error of operation 'updatePreferences', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type UpdatePreferencesResult = UpdatePreferencesResponse200 | UpdatePreferencesErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskScopes:
    """The scopes operation 'updateTask' resolved, one per scope."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskInput:
    """The input of operation 'updateTask', as its handler reads it."""

    path: _schemas.UpdateTaskPath
    headers: _schemas.UpdateTaskHeaders
    body: _schemas.UpdateTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskRequest:
    """What the handler of operation 'updateTask' reads: its input and who is calling."""

    input: UpdateTaskInput
    principal: _schemas.UserPrincipal
    scopes: UpdateTaskScopes


@_dataclasses.dataclass(frozen=True, slots=True)
class UpdateTaskResponse200:
    """The 200 reply of operation 'updateTask'."""

    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True)
class UpdateTaskErrors:
    """A declared error of operation 'updateTask', returned by its handler instead of raised."""

    code: str
    params: _pydantic.BaseModel | None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls("api.schema_invalid", params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls("api.unauthenticated", None)

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls("api.csrf_invalid", None)

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls("api.forbidden", params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls("api.idempotency_in_progress", None)

    @classmethod
    def state_conflict(cls) -> _typing.Self:
        return cls("state.conflict", None)

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls("api.payload_too_large", params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls("api.unsupported_media_type", None)

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls("api.idempotency_key_reused", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)


type UpdateTaskResult = UpdateTaskResponse200 | UpdateTaskErrors


class TasksEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def archive_task(self, request: ArchiveTaskRequest, /) -> ArchiveTaskResult | _abc.Awaitable[ArchiveTaskResult]: ...
    def assign_task(self, request: AssignTaskRequest, /) -> AssignTaskResult | _abc.Awaitable[AssignTaskResult]: ...
    def create_task(self, request: CreateTaskRequest, /) -> CreateTaskResult | _abc.Awaitable[CreateTaskResult]: ...
    def get_task(self, request: GetTaskRequest, /) -> GetTaskResult | _abc.Awaitable[GetTaskResult]: ...
    def get_tasks_batch(
        self, request: GetTasksBatchRequest, /
    ) -> GetTasksBatchResult | _abc.Awaitable[GetTasksBatchResult]: ...
    def list_tasks(self, request: ListTasksRequest, /) -> ListTasksResult | _abc.Awaitable[ListTasksResult]: ...
    def purge_task(self, request: PurgeTaskRequest, /) -> PurgeTaskResult | _abc.Awaitable[PurgeTaskResult]: ...
    def search_tasks(self, request: SearchTasksRequest, /) -> SearchTasksResult | _abc.Awaitable[SearchTasksResult]: ...
    def update_task(self, request: UpdateTaskRequest, /) -> UpdateTaskResult | _abc.Awaitable[UpdateTaskResult]: ...


class DraftsEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def delete_draft(self, request: DeleteDraftRequest, /) -> DeleteDraftResult | _abc.Awaitable[DeleteDraftResult]: ...
    def get_draft(self, request: GetDraftRequest, /) -> GetDraftResult | _abc.Awaitable[GetDraftResult]: ...


class ChannelsEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def get_channel(self, request: GetChannelRequest, /) -> GetChannelResult | _abc.Awaitable[GetChannelResult]: ...
    def list_channels(
        self, request: ListChannelsRequest, /
    ) -> ListChannelsResult | _abc.Awaitable[ListChannelsResult]: ...


class PreferencesEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def get_preferences(
        self, request: GetPreferencesRequest, /
    ) -> GetPreferencesResult | _abc.Awaitable[GetPreferencesResult]: ...
    def update_preferences(
        self, request: UpdatePreferencesRequest, /
    ) -> UpdatePreferencesResult | _abc.Awaitable[UpdatePreferencesResult]: ...


class AppEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def health(self, request: HealthRequest, /) -> HealthResult | _abc.Awaitable[HealthResult]: ...


class HooksEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def payments(self, request: PaymentsRequest, /) -> PaymentsResult | _abc.Awaitable[PaymentsResult]: ...
