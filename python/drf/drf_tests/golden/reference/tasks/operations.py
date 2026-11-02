"""The operation types, exceptions and handler protocols of api 'tasks'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing
import uuid as _uuid

import seampact.hooks as _hooks

from . import schemas as _schemas


class TasksContractError(Exception):
    """A declared error of api 'tasks', raised by a handler or a hook instead of returned."""

    code: _typing.ClassVar[str]

    def __init__(self, params: object | None = None) -> None:
        super().__init__(self.code)
        self.params = params


class ApiCsrfInvalidError(TasksContractError):
    """The error 'api.csrf_invalid'."""

    code = "api.csrf_invalid"


class ApiForbiddenError(TasksContractError):
    """The error 'api.forbidden'."""

    code = "api.forbidden"

    def __init__(self, params: _schemas.ApiForbiddenParams) -> None:
        super().__init__(params)


class ApiIdempotencyInProgressError(TasksContractError):
    """The error 'api.idempotency_in_progress'."""

    code = "api.idempotency_in_progress"


class ApiIdempotencyKeyReusedError(TasksContractError):
    """The error 'api.idempotency_key_reused'."""

    code = "api.idempotency_key_reused"


class ApiInternalError(TasksContractError):
    """The error 'api.internal'."""

    code = "api.internal"


class ApiNotFoundError(TasksContractError):
    """The error 'api.not_found'."""

    code = "api.not_found"


class ApiPayloadTooLargeError(TasksContractError):
    """The error 'api.payload_too_large'."""

    code = "api.payload_too_large"

    def __init__(self, params: _schemas.ApiPayloadTooLargeParams) -> None:
        super().__init__(params)


class ApiRateLimitedError(TasksContractError):
    """The error 'api.rate_limited'."""

    code = "api.rate_limited"

    def __init__(self, params: _schemas.ApiRateLimitedParams) -> None:
        super().__init__(params)


class ApiReauthenticationRequiredError(TasksContractError):
    """The error 'api.reauthentication_required'."""

    code = "api.reauthentication_required"


class ApiSchemaInvalidError(TasksContractError):
    """The error 'api.schema_invalid'."""

    code = "api.schema_invalid"

    def __init__(self, params: _schemas.ApiSchemaInvalidParams) -> None:
        super().__init__(params)


class ApiUnauthenticatedError(TasksContractError):
    """The error 'api.unauthenticated'."""

    code = "api.unauthenticated"


class ApiUnsupportedMediaTypeError(TasksContractError):
    """The error 'api.unsupported_media_type'."""

    code = "api.unsupported_media_type"


class StateConflictError(TasksContractError):
    """The error 'state.conflict'."""

    code = "state.conflict"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskPath:
    """The path parameters of operation 'archiveTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskHeaders:
    """The headers parameters of operation 'archiveTask'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskInput:
    """The input of operation 'archiveTask', as its handler reads it."""

    path: ArchiveTaskPath
    headers: ArchiveTaskHeaders
    body: _schemas.ArchiveTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskScopes:
    """The scopes operation 'archiveTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


class _Redacted:
    """Stands for a sensitive value in a `repr`."""

    def __repr__(self) -> str:
        return "[redacted]"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class ArchiveTaskRequest:
    """What the handler of operation 'archiveTask' is called with."""

    input: ArchiveTaskInput
    principal: _schemas.UserPrincipal
    scopes: ArchiveTaskScopes

    def __repr__(self) -> str:
        return f"ArchiveTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskResponse200:
    """The 200 reply of operation 'archiveTask'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTaskErrors:
    """A declared error of operation 'archiveTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def state_conflict(cls) -> _typing.Self:
        return cls(code="state.conflict")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type ArchiveTaskResult = ArchiveTaskResponse200 | ArchiveTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskPath:
    """The path parameters of operation 'assignTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskHeaders:
    """The headers parameters of operation 'assignTask'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskInput:
    """The input of operation 'assignTask', as its handler reads it."""

    path: AssignTaskPath
    headers: AssignTaskHeaders
    body: _schemas.AssignTaskInput


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskScopes:
    """The scopes operation 'assignTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class AssignTaskRequest:
    """What the handler of operation 'assignTask' is called with."""

    input: AssignTaskInput
    principal: _schemas.UserPrincipal
    scopes: AssignTaskScopes

    def __repr__(self) -> str:
        return f"AssignTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskResponse200:
    """The 200 reply of operation 'assignTask'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskErrors:
    """A declared error of operation 'assignTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls(code="api.forbidden", params=params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type AssignTaskResult = AssignTaskResponse200 | AssignTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskPath:
    """The path parameters of operation 'createTask'."""

    channel_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskHeaders:
    """The headers parameters of operation 'createTask'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskInput:
    """The input of operation 'createTask', as its handler reads it."""

    path: CreateTaskPath
    headers: CreateTaskHeaders
    body: _schemas.CreateTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskScopes:
    """The scopes operation 'createTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class CreateTaskRequest:
    """What the handler of operation 'createTask' is called with."""

    input: CreateTaskInput
    principal: _schemas.UserPrincipal
    scopes: CreateTaskScopes

    def __repr__(self) -> str:
        return f"CreateTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskResponse201:
    """The 201 reply of operation 'createTask'."""

    status: _typing.ClassVar[int] = 201
    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTaskErrors:
    """A declared error of operation 'createTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls(code="api.forbidden", params=params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_rate_limited(cls, params: _schemas.ApiRateLimitedParams) -> _typing.Self:
        return cls(code="api.rate_limited", params=params)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type CreateTaskResult = CreateTaskResponse201 | CreateTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftPath:
    """The path parameters of operation 'deleteDraft'."""

    draft_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftHeaders:
    """The headers parameters of operation 'deleteDraft'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftInput:
    """The input of operation 'deleteDraft', as its handler reads it."""

    path: DeleteDraftPath
    headers: DeleteDraftHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class DeleteDraftRequest:
    """What the handler of operation 'deleteDraft' is called with."""

    input: DeleteDraftInput
    principal: _schemas.UserPrincipal

    def __repr__(self) -> str:
        return f"DeleteDraftRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftResponse200:
    """The 200 reply of operation 'deleteDraft'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Draft


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class DeleteDraftErrors:
    """A declared error of operation 'deleteDraft', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type DeleteDraftResult = DeleteDraftResponse200 | DeleteDraftErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelPath:
    """The path parameters of operation 'getChannel'."""

    channel_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelInput:
    """The input of operation 'getChannel', as its handler reads it."""

    path: GetChannelPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelScopes:
    """The scopes operation 'getChannel' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetChannelRequest:
    """What the handler of operation 'getChannel' is called with."""

    input: GetChannelInput
    principal: _schemas.UserPrincipal
    scopes: GetChannelScopes

    def __repr__(self) -> str:
        return f"GetChannelRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelResponse200:
    """The 200 reply of operation 'getChannel'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Channel


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetChannelErrors:
    """A declared error of operation 'getChannel', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type GetChannelResult = GetChannelResponse200 | GetChannelErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftPath:
    """The path parameters of operation 'getDraft'."""

    draft_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftInput:
    """The input of operation 'getDraft', as its handler reads it."""

    path: GetDraftPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetDraftRequest:
    """What the handler of operation 'getDraft' is called with."""

    input: GetDraftInput
    principal: _schemas.UserPrincipal

    def __repr__(self) -> str:
        return f"GetDraftRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftResponse200:
    """The 200 reply of operation 'getDraft'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Draft


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetDraftErrors:
    """A declared error of operation 'getDraft', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type GetDraftResult = GetDraftResponse200 | GetDraftErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesHeaders:
    """The headers parameters of operation 'getPreferences'."""

    if_none_match: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesInput:
    """The input of operation 'getPreferences', as its handler reads it."""

    headers: GetPreferencesHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetPreferencesRequest:
    """What the handler of operation 'getPreferences' is called with."""

    input: GetPreferencesInput
    principal: _schemas.UserPrincipal

    def __repr__(self) -> str:
        return f"GetPreferencesRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesResponse200:
    """The 200 reply of operation 'getPreferences'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Preferences


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesResponse304:
    """The 304 reply of operation 'getPreferences'."""

    status: _typing.ClassVar[int] = 304


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetPreferencesErrors:
    """A declared error of operation 'getPreferences', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type GetPreferencesResult = GetPreferencesResponse200 | GetPreferencesResponse304 | GetPreferencesErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskPath:
    """The path parameters of operation 'getTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskInput:
    """The input of operation 'getTask', as its handler reads it."""

    path: GetTaskPath


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskScopes:
    """The scopes operation 'getTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetTaskRequest:
    """What the handler of operation 'getTask' is called with."""

    input: GetTaskInput
    principal: _schemas.UserPrincipal
    scopes: GetTaskScopes

    def __repr__(self) -> str:
        return f"GetTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskResponse200:
    """The 200 reply of operation 'getTask'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskErrors:
    """A declared error of operation 'getTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type GetTaskResult = GetTaskResponse200 | GetTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchPath:
    """The path parameters of operation 'getTasksBatch'."""

    channel_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchInput:
    """The input of operation 'getTasksBatch', as its handler reads it."""

    path: GetTasksBatchPath
    body: _schemas.GetTasksBatchInput


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchScopes:
    """The scopes operation 'getTasksBatch' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetTasksBatchRequest:
    """What the handler of operation 'getTasksBatch' is called with."""

    input: GetTasksBatchInput
    principal: _schemas.UserPrincipal
    scopes: GetTasksBatchScopes

    def __repr__(self) -> str:
        return f"GetTasksBatchRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchResponse200:
    """The 200 reply of operation 'getTasksBatch'."""

    status: _typing.ClassVar[int] = 200
    body: dict[str, _schemas.Task]


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchErrors:
    """A declared error of operation 'getTasksBatch', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type GetTasksBatchResult = GetTasksBatchResponse200 | GetTasksBatchErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthInput:
    """The input of operation 'health', as its handler reads it."""


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthRequest:
    """What the handler of operation 'health' is called with."""

    input: HealthInput


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthResponse200:
    """The 200 reply of operation 'health'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Health


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class HealthErrors:
    """A declared error of operation 'health', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type HealthResult = HealthResponse200 | HealthErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsQuery:
    """The query parameters of operation 'listChannels'."""

    cursor: str | None = None
    limit: int | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsInput:
    """The input of operation 'listChannels', as its handler reads it."""

    query: ListChannelsQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class ListChannelsRequest:
    """What the handler of operation 'listChannels' is called with."""

    input: ListChannelsInput
    principal: _schemas.UserPrincipal

    def __repr__(self) -> str:
        return f"ListChannelsRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsPage:
    """The page operation 'listChannels' answers: its items and its paging facts."""

    items: list[_schemas.Channel]
    next_cursor: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsResponse200:
    """The 200 reply of operation 'listChannels'."""

    status: _typing.ClassVar[int] = 200
    body: ListChannelsPage


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListChannelsErrors:
    """A declared error of operation 'listChannels', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type ListChannelsResult = ListChannelsResponse200 | ListChannelsErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksPath:
    """The path parameters of operation 'listTasks'."""

    channel_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksQuery:
    """The query parameters of operation 'listTasks'."""

    cursor: str | None = None
    limit: int | None = None
    sort: list[str] | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksInput:
    """The input of operation 'listTasks', as its handler reads it."""

    path: ListTasksPath
    query: ListTasksQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksScopes:
    """The scopes operation 'listTasks' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class ListTasksRequest:
    """What the handler of operation 'listTasks' is called with."""

    input: ListTasksInput
    principal: _schemas.UserPrincipal
    scopes: ListTasksScopes

    def __repr__(self) -> str:
        return f"ListTasksRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksPage:
    """The page operation 'listTasks' answers: its items and its paging facts."""

    items: list[_schemas.Task]
    next_cursor: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksResponse200:
    """The 200 reply of operation 'listTasks'."""

    status: _typing.ClassVar[int] = 200
    body: ListTasksPage


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ListTasksErrors:
    """A declared error of operation 'listTasks', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type ListTasksResult = ListTasksResponse200 | ListTasksErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class PaymentsInput:
    """The input of operation 'payments', as its handler reads it."""

    body: _schemas.PaymentEvent

    def __repr__(self) -> str:
        return "PaymentsInput(body=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "body", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class PaymentsRequest:
    """What the handler of operation 'payments' is called with."""

    input: PaymentsInput
    principal: _schemas.WebhookCaller

    def __repr__(self) -> str:
        return f"PaymentsRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PaymentsResponse204:
    """The 204 reply of operation 'payments'."""

    status: _typing.ClassVar[int] = 204


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PaymentsErrors:
    """A declared error of operation 'payments', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type PaymentsResult = PaymentsResponse204 | PaymentsErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskPath:
    """The path parameters of operation 'purgeTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskHeaders:
    """The headers parameters of operation 'purgeTask'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskInput:
    """The input of operation 'purgeTask', as its handler reads it."""

    path: PurgeTaskPath
    headers: PurgeTaskHeaders
    body: _schemas.ApiEmptyBody


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskScopes:
    """The scopes operation 'purgeTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class PurgeTaskRequest:
    """What the handler of operation 'purgeTask' is called with."""

    input: PurgeTaskInput
    principal: _schemas.UserPrincipal
    scopes: PurgeTaskScopes

    def __repr__(self) -> str:
        return f"PurgeTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskResponse204:
    """The 204 reply of operation 'purgeTask'."""

    status: _typing.ClassVar[int] = 204


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PurgeTaskErrors:
    """A declared error of operation 'purgeTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_reauthentication_required(cls) -> _typing.Self:
        return cls(code="api.reauthentication_required")

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type PurgeTaskResult = PurgeTaskResponse204 | PurgeTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksPath:
    """The path parameters of operation 'searchTasks'."""

    channel_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksInput:
    """The input of operation 'searchTasks', as its handler reads it."""

    path: SearchTasksPath
    body: _schemas.TaskQuery


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksScopes:
    """The scopes operation 'searchTasks' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class SearchTasksRequest:
    """What the handler of operation 'searchTasks' is called with."""

    input: SearchTasksInput
    principal: _schemas.UserPrincipal
    scopes: SearchTasksScopes

    def __repr__(self) -> str:
        return f"SearchTasksRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksResponse200:
    """The 200 reply of operation 'searchTasks'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.TaskSearchResult


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class SearchTasksErrors:
    """A declared error of operation 'searchTasks', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls(code="api.forbidden", params=params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type SearchTasksResult = SearchTasksResponse200 | SearchTasksErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesHeaders:
    """The headers parameters of operation 'updatePreferences'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesInput:
    """The input of operation 'updatePreferences', as its handler reads it."""

    headers: UpdatePreferencesHeaders
    body: _schemas.UpdatePreferences


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class UpdatePreferencesRequest:
    """What the handler of operation 'updatePreferences' is called with."""

    input: UpdatePreferencesInput
    principal: _schemas.UserPrincipal

    def __repr__(self) -> str:
        return f"UpdatePreferencesRequest(input={self.input!r}, principal=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesResponse200:
    """The 200 reply of operation 'updatePreferences'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Preferences


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferencesErrors:
    """A declared error of operation 'updatePreferences', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type UpdatePreferencesResult = UpdatePreferencesResponse200 | UpdatePreferencesErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskPath:
    """The path parameters of operation 'updateTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskHeaders:
    """The headers parameters of operation 'updateTask'."""

    idempotency_key: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskInput:
    """The input of operation 'updateTask', as its handler reads it."""

    path: UpdateTaskPath
    headers: UpdateTaskHeaders
    body: _schemas.UpdateTask


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskScopes:
    """The scopes operation 'updateTask' runs in, outermost first."""

    channel: _hooks.ResolvedScope


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class UpdateTaskRequest:
    """What the handler of operation 'updateTask' is called with."""

    input: UpdateTaskInput
    principal: _schemas.UserPrincipal
    scopes: UpdateTaskScopes

    def __repr__(self) -> str:
        return f"UpdateTaskRequest(input={self.input!r}, principal=[redacted], scopes=[redacted])"

    def __rich_repr__(self) -> _abc.Iterator[tuple[str, object]]:
        yield "input", self.input
        yield "principal", _Redacted()
        yield "scopes", _Redacted()


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskResponse200:
    """The 200 reply of operation 'updateTask'."""

    status: _typing.ClassVar[int] = 200
    body: _schemas.Task


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTaskErrors:
    """A declared error of operation 'updateTask', returned instead of raised."""

    code: str
    params: object | None = None

    @classmethod
    def api_schema_invalid(cls, params: _schemas.ApiSchemaInvalidParams) -> _typing.Self:
        return cls(code="api.schema_invalid", params=params)

    @classmethod
    def api_unauthenticated(cls) -> _typing.Self:
        return cls(code="api.unauthenticated")

    @classmethod
    def api_csrf_invalid(cls) -> _typing.Self:
        return cls(code="api.csrf_invalid")

    @classmethod
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls(code="api.forbidden", params=params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_idempotency_in_progress(cls) -> _typing.Self:
        return cls(code="api.idempotency_in_progress")

    @classmethod
    def state_conflict(cls) -> _typing.Self:
        return cls(code="state.conflict")

    @classmethod
    def api_payload_too_large(cls, params: _schemas.ApiPayloadTooLargeParams) -> _typing.Self:
        return cls(code="api.payload_too_large", params=params)

    @classmethod
    def api_unsupported_media_type(cls) -> _typing.Self:
        return cls(code="api.unsupported_media_type")

    @classmethod
    def api_idempotency_key_reused(cls) -> _typing.Self:
        return cls(code="api.idempotency_key_reused")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")


type UpdateTaskResult = UpdateTaskResponse200 | UpdateTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class StripeCredentials:
    """The credentials a request presents for identity 'stripe', one per scheme, None when absent."""

    stripe_signature: str | None = None

    def __repr__(self) -> str:
        return "StripeCredentials(stripe_signature=[redacted])"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UserCredentials:
    """The credentials a request presents for identity 'user', one per scheme, None when absent."""

    bearer: str | None = None
    session_cookie: str | None = None

    def __repr__(self) -> str:
        return "UserCredentials(bearer=[redacted], session_cookie=[redacted])"


@_typing.runtime_checkable
class TasksEndpoints(_typing.Protocol):
    """The handlers of 'tasks'; a factory builds them per request."""

    def archive_task(self, request: ArchiveTaskRequest) -> ArchiveTaskResult: ...

    def assign_task(self, request: AssignTaskRequest) -> AssignTaskResult: ...

    def create_task(self, request: CreateTaskRequest) -> CreateTaskResult: ...

    def get_task(self, request: GetTaskRequest) -> GetTaskResult: ...

    def get_tasks_batch(self, request: GetTasksBatchRequest) -> GetTasksBatchResult: ...

    def list_tasks(self, request: ListTasksRequest) -> ListTasksResult: ...

    def purge_task(self, request: PurgeTaskRequest) -> PurgeTaskResult: ...

    def search_tasks(self, request: SearchTasksRequest) -> SearchTasksResult: ...

    def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult: ...


@_typing.runtime_checkable
class DraftsEndpoints(_typing.Protocol):
    """The handlers of 'drafts'; a factory builds them per request."""

    def delete_draft(self, request: DeleteDraftRequest) -> DeleteDraftResult: ...

    def get_draft(self, request: GetDraftRequest) -> GetDraftResult: ...


@_typing.runtime_checkable
class ChannelsEndpoints(_typing.Protocol):
    """The handlers of 'channels'; a factory builds them per request."""

    def get_channel(self, request: GetChannelRequest) -> GetChannelResult: ...

    def list_channels(self, request: ListChannelsRequest) -> ListChannelsResult: ...


@_typing.runtime_checkable
class PreferencesEndpoints(_typing.Protocol):
    """The handlers of 'preferences'; a factory builds them per request."""

    def get_preferences(self, request: GetPreferencesRequest) -> GetPreferencesResult: ...

    def update_preferences(self, request: UpdatePreferencesRequest) -> UpdatePreferencesResult: ...


@_typing.runtime_checkable
class AppEndpoints(_typing.Protocol):
    """The handlers of 'app'; a factory builds them per request."""

    def health(self, request: HealthRequest) -> HealthResult: ...


@_typing.runtime_checkable
class HooksEndpoints(_typing.Protocol):
    """The handlers of 'hooks'; a factory builds them per request."""

    def payments(self, request: PaymentsRequest) -> PaymentsResult: ...
