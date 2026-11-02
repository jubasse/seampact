"""The operation types, exceptions and handler protocols of api 'tasksService'."""

import dataclasses as _dataclasses
import typing as _typing
import uuid as _uuid

import seampact.drf.runtime as _drf_runtime

from . import schemas as _schemas


class TasksServiceContractError(Exception):
    """A declared error of api 'tasksService', raised by a handler or a hook instead of returned."""

    code: _typing.ClassVar[str]

    def __init__(self, params: object | None = None) -> None:
        super().__init__(self.code)
        self.params = params


class ApiDeadlineExceededError(TasksServiceContractError):
    """The error 'api.deadline_exceeded'."""

    code = "api.deadline_exceeded"


class ApiForbiddenError(TasksServiceContractError):
    """The error 'api.forbidden'."""

    code = "api.forbidden"

    def __init__(self, params: _schemas.ApiForbiddenParams) -> None:
        super().__init__(params)


class ApiInternalError(TasksServiceContractError):
    """The error 'api.internal'."""

    code = "api.internal"


class ApiNotFoundError(TasksServiceContractError):
    """The error 'api.not_found'."""

    code = "api.not_found"


class ApiSchemaInvalidError(TasksServiceContractError):
    """The error 'api.schema_invalid'."""

    code = "api.schema_invalid"

    def __init__(self, params: _schemas.ApiSchemaInvalidParams) -> None:
        super().__init__(params)


class ApiUnauthenticatedError(TasksServiceContractError):
    """The error 'api.unauthenticated'."""

    code = "api.unauthenticated"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskPath:
    """The path parameters of operation 'getTask'."""

    channel_id: _uuid.UUID
    task_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskHeaders:
    """The headers parameters of operation 'getTask'."""

    x_deadline: str
    traceparent: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskInput:
    """The input of operation 'getTask', as its handler reads it."""

    path: GetTaskPath
    headers: GetTaskHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True, repr=False)
class GetTaskRequest(_drf_runtime.RedactedRepr):
    """What the handler of operation 'getTask' is called with."""

    _REDACTED_FIELDS: _typing.ClassVar[frozenset[str]] = frozenset({"principal"})
    input: GetTaskInput
    principal: _schemas.ServicePrincipal


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
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls(code="api.forbidden", params=params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls(code="api.not_found")

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls(code="api.internal")

    @classmethod
    def api_deadline_exceeded(cls) -> _typing.Self:
        return cls(code="api.deadline_exceeded")


type GetTaskResult = GetTaskResponse200 | GetTaskErrors


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ServiceCredentials:
    """The credentials a request presents for identity 'service', one per scheme, None when absent."""

    internal_token: str | None = None

    def __repr__(self) -> str:
        return "ServiceCredentials(internal_token=[redacted])"


@_typing.runtime_checkable
class InternalEndpoints(_typing.Protocol):
    """The handlers of 'internal'; a factory builds them per request."""

    def get_task(self, request: GetTaskRequest) -> GetTaskResult: ...
