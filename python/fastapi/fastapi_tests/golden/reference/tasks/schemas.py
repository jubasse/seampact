"""The schema types of api 'tasks'."""

import enum as _enum
import typing as _typing

import pydantic as _pydantic

import seampact.codegen.runtime.pydantic as _seampact

_MODEL_CONFIG = _pydantic.ConfigDict(
    strict=True,
    frozen=True,
    extra="forbid",
    protected_namespaces=(),
    regex_engine="rust-regex",
    allow_inf_nan=False,
)


class ReauthIntent(_enum.StrEnum):
    PURGE_TASK = "purge_task"


class Role(_enum.StrEnum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class Service(_enum.StrEnum):
    CATALOG = "catalog"
    TICKETING = "ticketing"


class Surface(_enum.StrEnum):
    APP = "app"
    STUDIO = "studio"


class TaskState(_enum.StrEnum):
    OPEN = "open"
    DONE = "done"
    ARCHIVED = "archived"


class ApiEmptyBody(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG


class ApiForbiddenParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    pointer: _seampact.Omittable[str] = None


class ApiPayloadTooLargeParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    limit_bytes: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0)]] = None


class ApiRateLimitedParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    retry_after_ms: _typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0, le=9007199254740991)]


class IssuesItem(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    pointer: str
    rule: str


class ApiSchemaInvalidParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    issues: list[IssuesItem]


class ArchiveTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    reason: _typing.Annotated[str, _pydantic.Field(min_length=1, max_length=500)]
    expected_version: _typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=1)]


class AssignTaskInput(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    user_id: _seampact.WireUuid


class Channel(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    name: _typing.Annotated[str, _pydantic.Field(min_length=1, max_length=100)]


class CreateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _typing.Annotated[str, _pydantic.Field(min_length=1, max_length=200)]
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0)]] = None


class Draft(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    draft_id: _seampact.WireUuid
    body: _typing.Annotated[str, _pydantic.Field(max_length=20000)]


class GetTasksBatchInput(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    ids: _typing.Annotated[list[_seampact.WireUuid], _pydantic.Field(max_length=200)]


class Health(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    status: str


class PaymentEvent(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    id_: str
    type_: str
    data: _pydantic.JsonValue


class Preferences(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    locale: _typing.Annotated[str, _pydantic.Field(min_length=2, max_length=35)]
    digest: _seampact.Omittable[bool] = None


class RecentAuthParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    intent: _typing.Annotated[ReauthIntent, _seampact.enum_from_wire(ReauthIntent)]


class RolesParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    allowed: _typing.Annotated[
        list[_typing.Annotated[Role, _seampact.enum_from_wire(Role)]],
        _pydantic.Field(min_length=1),
    ]


class ServicePrincipal(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    service: _typing.Annotated[Service, _seampact.enum_from_wire(Service)]
    user_id: _seampact.WireUuid


class Task(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    task_id: _seampact.WireUuid
    title: _typing.Annotated[str, _pydantic.Field(min_length=1, max_length=200)]
    state: _typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0)]] = None
    version: _typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=1)]
    created_at: _seampact.WireDateTime


class TaskQuery(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    text: _seampact.Omittable[_typing.Annotated[str, _pydantic.Field(max_length=200)]] = None
    states: _seampact.Omittable[
        _typing.Annotated[
            list[_typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]],
            _pydantic.Field(max_length=3),
        ]
    ] = None


class TaskSearchResult(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    items: list[Task]
    total: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0)]] = None


class UpdatePreferences(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    locale: _seampact.Omittable[_typing.Annotated[str, _pydantic.Field(min_length=2, max_length=35)]] = None
    digest: _seampact.Omittable[bool] = None


class UpdateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _seampact.Omittable[_typing.Annotated[str, _pydantic.Field(min_length=1, max_length=200)]] = None
    state: _seampact.Omittable[_typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]] = None
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=0)]] = None
    expected_version: _typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=1)]


class UserPrincipal(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    user_id: _seampact.WireUuid


class WebhookCaller(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    account: str


class ArchiveTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class ArchiveTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid


class AssignTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class AssignTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid


class CreateTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class CreateTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid


class DeleteDraftHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class DeleteDraftPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    draft_id: _seampact.WireUuid


class GetChannelPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid


class GetDraftPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    draft_id: _seampact.WireUuid


class GetPreferencesHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    if_none_match: _seampact.Omittable[str] = None


class GetTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid


class GetTasksBatchPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid


class ListChannelsQuery(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    cursor: _seampact.Omittable[str] = None
    limit: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=1, le=100)]] = None


class ListTasksPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid


class ListTasksQuery(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    cursor: _seampact.Omittable[str] = None
    limit: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _pydantic.Field(ge=1, le=50)]] = None
    sort: _seampact.Omittable[list[_typing.Annotated[str, _pydantic.Field(pattern="^(?:createdAt|-createdAt)$")]]] = (
        None
    )


class PurgeTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class PurgeTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid


class SearchTasksPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid


class UpdatePreferencesHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class UpdateTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    idempotency_key: str


class UpdateTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid


SCHEMA_MEMBERS: _typing.Final = {
    "ApiEmptyBody": {},
    "ApiForbiddenParams": {
        "pointer": "pointer",
    },
    "ApiPayloadTooLargeParams": {
        "limitBytes": "limit_bytes",
    },
    "ApiRateLimitedParams": {
        "retryAfterMs": "retry_after_ms",
    },
    "ApiSchemaInvalidParams": {
        "issues": "issues",
    },
    "ArchiveTask": {
        "reason": "reason",
        "expectedVersion": "expected_version",
    },
    "AssignTaskInput": {
        "userId": "user_id",
    },
    "Channel": {
        "channelId": "channel_id",
        "name": "name",
    },
    "CreateTask": {
        "title": "title",
        "effort": "effort",
    },
    "Draft": {
        "draftId": "draft_id",
        "body": "body",
    },
    "GetTasksBatchInput": {
        "ids": "ids",
    },
    "Health": {
        "status": "status",
    },
    "IssuesItem": {
        "pointer": "pointer",
        "rule": "rule",
    },
    "PaymentEvent": {
        "id": "id_",
        "type": "type_",
        "data": "data",
    },
    "Preferences": {
        "locale": "locale",
        "digest": "digest",
    },
    "RecentAuthParams": {
        "intent": "intent",
    },
    "RolesParams": {
        "allowed": "allowed",
    },
    "ServicePrincipal": {
        "service": "service",
        "userId": "user_id",
    },
    "Task": {
        "taskId": "task_id",
        "title": "title",
        "state": "state",
        "effort": "effort",
        "version": "version",
        "createdAt": "created_at",
    },
    "TaskQuery": {
        "text": "text",
        "states": "states",
    },
    "TaskSearchResult": {
        "items": "items",
        "total": "total",
    },
    "UpdatePreferences": {
        "locale": "locale",
        "digest": "digest",
    },
    "UpdateTask": {
        "title": "title",
        "state": "state",
        "effort": "effort",
        "expectedVersion": "expected_version",
    },
    "UserPrincipal": {
        "userId": "user_id",
    },
    "WebhookCaller": {
        "account": "account",
    },
    "archiveTask.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "archiveTask.path": {
        "channelId": "channel_id",
        "taskId": "task_id",
    },
    "assignTask.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "assignTask.path": {
        "channelId": "channel_id",
        "taskId": "task_id",
    },
    "createTask.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "createTask.path": {
        "channelId": "channel_id",
    },
    "deleteDraft.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "deleteDraft.path": {
        "draftId": "draft_id",
    },
    "getChannel.path": {
        "channelId": "channel_id",
    },
    "getDraft.path": {
        "draftId": "draft_id",
    },
    "getPreferences.headers": {
        "If-None-Match": "if_none_match",
    },
    "getTask.path": {
        "channelId": "channel_id",
        "taskId": "task_id",
    },
    "getTasksBatch.path": {
        "channelId": "channel_id",
    },
    "listChannels.query": {
        "cursor": "cursor",
        "limit": "limit",
    },
    "listTasks.path": {
        "channelId": "channel_id",
    },
    "listTasks.query": {
        "cursor": "cursor",
        "limit": "limit",
        "sort": "sort",
    },
    "purgeTask.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "purgeTask.path": {
        "channelId": "channel_id",
        "taskId": "task_id",
    },
    "searchTasks.path": {
        "channelId": "channel_id",
    },
    "updatePreferences.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "updateTask.headers": {
        "Idempotency-Key": "idempotency_key",
    },
    "updateTask.path": {
        "channelId": "channel_id",
        "taskId": "task_id",
    },
}
