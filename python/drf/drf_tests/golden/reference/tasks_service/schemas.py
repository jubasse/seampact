"""The schema types of api 'tasksService'."""

import dataclasses as _dataclasses
import datetime as _datetime
import enum as _enum
import uuid as _uuid


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


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiForbiddenParams:
    pointer: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiSchemaInvalidParams:
    issues: "list[IssuesItem]"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CallerServiceParams:
    allowed: list[Service]


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class IssuesItem:
    pointer: str
    rule: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ServicePrincipal:
    service: Service
    user_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class Task:
    task_id: _uuid.UUID
    title: str
    state: TaskState
    effort: int | None = None
    version: int
    created_at: _datetime.datetime


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UserPrincipal:
    user_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class WebhookCaller:
    account: str
