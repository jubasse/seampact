"""The schema types of api 'tasks'."""

import dataclasses as _dataclasses
import datetime as _datetime
import enum as _enum
import uuid as _uuid


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


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiEmptyBody:
    """The schema 'ApiEmptyBody', which has no member."""


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiForbiddenParams:
    pointer: str | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiPayloadTooLargeParams:
    limit_bytes: int | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiRateLimitedParams:
    retry_after_ms: int


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ApiSchemaInvalidParams:
    issues: "list[IssuesItem]"


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class ArchiveTask:
    reason: str
    expected_version: int


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class AssignTaskInput:
    user_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class Channel:
    channel_id: _uuid.UUID
    name: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class CreateTask:
    title: str
    effort: int | None = None
    data: str
    errors: str
    fields: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class Draft:
    draft_id: _uuid.UUID
    body: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class GetTasksBatchInput:
    ids: list[_uuid.UUID]


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class Health:
    status: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class IssuesItem:
    pointer: str
    rule: str


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class PaymentEvent:
    id_: str
    type_: str
    data: object


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class Preferences:
    locale: str
    digest: bool | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class RecentAuthParams:
    intent: ReauthIntent


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class RolesParams:
    allowed: list[Role]


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
class TaskQuery:
    text: str | None = None
    states: list[TaskState] | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class TaskSearchResult:
    items: list[Task]
    total: int | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdatePreferences:
    locale: str | None = None
    digest: bool | None = None


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UpdateTask:
    title: str | None = None
    state: TaskState | None = None
    effort: int | None = None
    expected_version: int


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class UserPrincipal:
    user_id: _uuid.UUID


@_dataclasses.dataclass(frozen=True, slots=True, kw_only=True)
class WebhookCaller:
    account: str
