"""The schema types of api 'tasksService'."""

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


class ApiForbiddenParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    pointer: _seampact.Omittable[str] = None


class IssuesItem(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    pointer: str
    rule: str


class ApiSchemaInvalidParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    issues: list[IssuesItem]


class CallerServiceParams(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    allowed: _typing.Annotated[
        list[_typing.Annotated[Service, _seampact.enum_from_wire(Service)]],
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


class UserPrincipal(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    user_id: _seampact.WireUuid


class WebhookCaller(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    account: str


class GetTaskHeaders(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    x_deadline: str
    traceparent: _seampact.Omittable[str] = None


class GetTaskPath(_pydantic.BaseModel):
    model_config = _MODEL_CONFIG

    channel_id: _seampact.WireUuid
    task_id: _seampact.WireUuid
