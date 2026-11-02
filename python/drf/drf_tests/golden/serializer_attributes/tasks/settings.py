"""The settings of api 'tasks', read from settings.SEAMPACT["tasks"]."""

import collections.abc as _abc
import typing as _typing


class TasksHandlerSettings(_typing.TypedDict):
    """The dotted path of each handler factory, which builds the handlers from the HttpRequest."""

    tasks: str


class TasksOperationSettings(_typing.TypedDict, total=False):
    """What one operation sets over the api's settings."""

    responses: _typing.Literal["strict", "warn"]


class TasksSettings(_typing.TypedDict, total=False):
    """The value of settings.SEAMPACT["tasks"]."""

    handlers: _typing.Required[TasksHandlerSettings]
    authenticate: _abc.Mapping[str, str]
    deciders: _abc.Mapping[str, str]
    scope_resolvers: _abc.Mapping[str, str]
    idempotency_store: str
    on_unexpected_error: str
    responses: _typing.Literal["strict", "warn"]
    body_validation: bool
    public_origin: str
    operations: _abc.Mapping[str, TasksOperationSettings]
    access: _abc.Mapping[str, _abc.Mapping[str, _abc.Sequence[str]]]


SETTINGS_KEYS: _typing.Final = (
    "handlers",
    "authenticate",
    "deciders",
    "scope_resolvers",
    "idempotency_store",
    "on_unexpected_error",
    "responses",
    "body_validation",
    "public_origin",
    "operations",
    "access",
)
