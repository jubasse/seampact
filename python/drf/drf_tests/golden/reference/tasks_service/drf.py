"""The DRF placement of api 'tasksService': its serializers, views and exception handler."""

import collections.abc as _abc
import typing as _typing
import uuid as _uuid

import django.http as _http
import rest_framework.request as _request

import seampact.django.runtime as _django_runtime
import seampact.drf.runtime as _drf_runtime

from . import contract as _contract
from . import operations as _operations
from . import schemas as _schemas


class GetTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'getTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class GetTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'getTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "x_deadline": _drf_runtime.ContractTextField(),
            "traceparent": _drf_runtime.ContractTextField(required=False),
        }


class GetTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": GetTaskPathSerializer(),
            "headers": GetTaskHeadersSerializer(),
        }


def contract_exception_handler(
    exception: Exception, context: _abc.Mapping[str, object]
) -> _http.HttpResponseBase | None:
    """The exception handler of the contract views, never the app's EXCEPTION_HANDLER."""
    return _drf_runtime.contract_exception_reply("tasksService", exception, context)


class TasksServiceView(_drf_runtime.ContractView):
    """The base of the contract views of api 'tasksService'."""

    api = "tasksService"
    contract = _contract.CONTRACT
    credentials: _typing.ClassVar[_abc.Mapping[str, _drf_runtime.CredentialsType]] = {
        "service": _drf_runtime.CredentialsType(_operations.ServiceCredentials, {"internalToken": "internal_token"}),
    }

    def get_exception_handler(self) -> _drf_runtime.ExceptionHandler:
        return contract_exception_handler


def _internal_handlers(request: _http.HttpRequest) -> _operations.InternalEndpoints:
    built = _django_runtime.built_handlers("tasksService", "internal", request)

    if isinstance(built, _operations.InternalEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasksService", "internal", "InternalEndpoints", built)


class GetTaskView(TasksServiceView):
    """The contract path `/internal/v1/channels/{channelId}/tasks/{taskId}`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getTask")
        contract_request = _operations.GetTaskRequest(
            input=admission.input(GetTaskRequestSerializer, _operations.GetTaskInput),
            principal=admission.principal(_schemas.ServicePrincipal),
        )

        return admission.reply(_internal_handlers(request).get_task(contract_request))
