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
    hide_input_in_errors=True,
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

    limit_bytes: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None


class ApiRateLimitedParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    retry_after_ms: _typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0", maximum="9007199254740991")]


class IssuesItem(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    pointer: str
    rule: str


class ApiSchemaInvalidParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    issues: list[IssuesItem]


class ArchiveTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    reason: _typing.Annotated[str, _seampact.length(min_length=1, max_length=500)]
    expected_version: _typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="1")]


class AssignTaskInput(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    user_id: _seampact.WireUuid


class Channel(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    name: _typing.Annotated[str, _seampact.length(min_length=1, max_length=100)]


class CreateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _typing.Annotated[str, _seampact.length(min_length=1, max_length=200)]
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None


class Draft(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    draft_id: _seampact.WireUuid
    body: _typing.Annotated[str, _seampact.length(max_length=20000)]


class GetTasksBatchInput(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    ids: _typing.Annotated[list[_seampact.WireUuid], _seampact.length(max_length=200)]


class Health(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    status: str


class PaymentEvent(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    id_: str
    type_: str
    data: _seampact.Opaque


class Preferences(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    locale: _typing.Annotated[str, _seampact.length(min_length=2, max_length=35)]
    digest: _seampact.Omittable[bool] = None


class RecentAuthParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    intent: _typing.Annotated[ReauthIntent, _seampact.enum_from_wire(ReauthIntent)]


class RolesParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    allowed: _typing.Annotated[
        list[_typing.Annotated[Role, _seampact.enum_from_wire(Role)]],
        _seampact.length(min_length=1),
    ]


class ServicePrincipal(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    service: _typing.Annotated[Service, _seampact.enum_from_wire(Service)]
    user_id: _seampact.WireUuid


class Task(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    task_id: _seampact.WireUuid
    title: _typing.Annotated[str, _seampact.length(min_length=1, max_length=200)]
    state: _typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None
    version: _typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="1")]
    created_at: _seampact.WireDateTime


class TaskQuery(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    text: _seampact.Omittable[_typing.Annotated[str, _seampact.length(max_length=200)]] = None
    states: _seampact.Omittable[
        _typing.Annotated[
            list[_typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]],
            _seampact.length(max_length=3),
        ]
    ] = None


class TaskSearchResult(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    items: list[Task]
    total: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None


class UpdatePreferences(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    locale: _seampact.Omittable[_typing.Annotated[str, _seampact.length(min_length=2, max_length=35)]] = None
    digest: _seampact.Omittable[bool] = None


class UpdateTask(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    title: _seampact.Omittable[_typing.Annotated[str, _seampact.length(min_length=1, max_length=200)]] = None
    state: _seampact.Omittable[_typing.Annotated[TaskState, _seampact.enum_from_wire(TaskState)]] = None
    effort: _seampact.Omittable[_typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="0")]] = None
    expected_version: _typing.Annotated[_seampact.WholeNumber, _seampact.bounds(minimum="1")]


class UserPrincipal(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    user_id: _seampact.WireUuid


class WebhookCaller(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    account: str
