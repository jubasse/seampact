"""The operation types, exceptions and handler protocols of api 'tasks'."""

import dataclasses as _dataclasses
import typing as _typing
import uuid as _uuid

import seampact.drf.runtime as _drf_runtime
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
class CreateTaskRequest(_drf_runtime.RedactedRepr):
    """What the handler of operation 'createTask' is called with."""

    _REDACTED_FIELDS: _typing.ClassVar[frozenset[str]] = frozenset({"principal", "scopes"})
    input: CreateTaskInput
    principal: _schemas.UserPrincipal
    scopes: CreateTaskScopes


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
class UserCredentials:
    """The credentials a request presents for identity 'user', one per scheme, None when absent."""

    bearer: str | None = None
    session_cookie: str | None = None

    def __repr__(self) -> str:
        return "UserCredentials(bearer=[redacted], session_cookie=[redacted])"


@_typing.runtime_checkable
class TasksEndpoints(_typing.Protocol):
    """The handlers of 'tasks'; a factory builds them per request."""

    def create_task(self, request: CreateTaskRequest) -> CreateTaskResult: ...
