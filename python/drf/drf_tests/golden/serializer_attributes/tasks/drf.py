"""The DRF placement of api 'tasks': its serializers, views and exception handler."""

import collections.abc as _abc
import uuid as _uuid

import django.http as _http
import rest_framework.request as _request
import rest_framework.serializers as _serializers

import seampact.django.runtime as _django_runtime
import seampact.drf.runtime as _drf_runtime

from . import operations as _operations
from . import schemas as _schemas


class CreateTaskSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'CreateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "title": _drf_runtime.ContractTextField(min_length=1, max_length=200),
            "effort": _serializers.IntegerField(required=False, min_value=0),
            "data": _drf_runtime.ContractTextField(min_length=1, max_length=200),
            "errors": _drf_runtime.ContractTextField(min_length=1, max_length=200),
            "fields": _drf_runtime.ContractTextField(min_length=1, max_length=200),
        }


class CreateTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'createTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class CreateTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'createTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class CreateTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'createTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": CreateTaskPathSerializer(),
            "headers": CreateTaskHeadersSerializer(),
            "body": CreateTaskSerializer(),
        }


def contract_exception_handler(
    exception: Exception, context: _abc.Mapping[str, object]
) -> _http.HttpResponseBase | None:
    """The exception handler of the contract views, never the app's EXCEPTION_HANDLER."""
    return _drf_runtime.contract_exception_reply("tasks", exception, context)


class TasksView(_drf_runtime.ContractView):
    """The base of the contract views of api 'tasks'."""

    api = "tasks"

    def get_exception_handler(self) -> _drf_runtime.ExceptionHandler:
        return contract_exception_handler


def _tasks_handlers(request: _http.HttpRequest) -> _operations.TasksEndpoints:
    built = _django_runtime.built_handlers("tasks", "tasks", request)

    if isinstance(built, _operations.TasksEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "tasks", "TasksEndpoints", built)


class CreateTaskView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "createTask")
        contract_request = _operations.CreateTaskRequest(
            input=admission.input(CreateTaskRequestSerializer, _operations.CreateTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.CreateTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).create_task(contract_request))
