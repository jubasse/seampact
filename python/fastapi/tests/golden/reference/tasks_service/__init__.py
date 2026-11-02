"""The operation types of api 'tasksService'."""

import collections.abc as _abc
import dataclasses as _dataclasses
import typing as _typing

import pydantic as _pydantic

from . import schemas as _schemas


class TasksServiceContractError(Exception):
    """A declared error of api 'tasksService', raised by a handler."""

    CODE: _typing.ClassVar[str]
    STATUS: _typing.ClassVar[int]

    def __init__(self, params: _pydantic.BaseModel | None = None) -> None:
        super().__init__(f"The declared error {self.CODE!r} of api 'tasksService'.")
        self.params = params


class ApiDeadlineExceededError(TasksServiceContractError):
    """The error 'api.deadline_exceeded'."""

    CODE = "api.deadline_exceeded"
    STATUS = 504


class ApiForbiddenError(TasksServiceContractError):
    """The error 'api.forbidden'."""

    CODE = "api.forbidden"
    STATUS = 403

    def __init__(self, params: _schemas.ApiForbiddenParams) -> None:
        super().__init__(params)


class ApiInternalError(TasksServiceContractError):
    """The error 'api.internal'."""

    CODE = "api.internal"
    STATUS = 500


class ApiNotFoundError(TasksServiceContractError):
    """The error 'api.not_found'."""

    CODE = "api.not_found"
    STATUS = 404


class ApiSchemaInvalidError(TasksServiceContractError):
    """The error 'api.schema_invalid'."""

    CODE = "api.schema_invalid"
    STATUS = 400

    def __init__(self, params: _schemas.ApiSchemaInvalidParams) -> None:
        super().__init__(params)


class ApiUnauthenticatedError(TasksServiceContractError):
    """The error 'api.unauthenticated'."""

    CODE = "api.unauthenticated"
    STATUS = 401


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskInput:
    """The input of operation 'getTask', as its handler reads it."""

    path: _schemas.GetTaskPath
    headers: _schemas.GetTaskHeaders


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTaskRequest:
    """What the handler of operation 'getTask' reads: its input and who is calling."""

    input: GetTaskInput
    principal: _schemas.ServicePrincipal


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
    def api_forbidden(cls, params: _schemas.ApiForbiddenParams) -> _typing.Self:
        return cls("api.forbidden", params)

    @classmethod
    def api_not_found(cls) -> _typing.Self:
        return cls("api.not_found", None)

    @classmethod
    def api_internal(cls) -> _typing.Self:
        return cls("api.internal", None)

    @classmethod
    def api_deadline_exceeded(cls) -> _typing.Self:
        return cls("api.deadline_exceeded", None)


type GetTaskResult = GetTaskResponse200 | GetTaskErrors


class InternalEndpoints(_typing.Protocol):
    """The handlers of these operations: each returns a declared success or error, or raises one."""

    def get_task(self, request: GetTaskRequest, /) -> GetTaskResult | _abc.Awaitable[GetTaskResult]: ...
