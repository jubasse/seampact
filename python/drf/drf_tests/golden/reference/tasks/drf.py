"""The DRF placement of api 'tasks': its serializers, views and exception handler."""

import collections.abc as _abc
import typing as _typing
import uuid as _uuid

import django.http as _http
import rest_framework.request as _request
import rest_framework.serializers as _serializers

import seampact.django.runtime as _django_runtime
import seampact.drf.runtime as _drf_runtime

from . import contract as _contract
from . import operations as _operations
from . import schemas as _schemas


class ApiEmptyBodySerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'ApiEmptyBody', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {}


class ArchiveTaskSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'ArchiveTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "reason": _drf_runtime.ContractTextField(min_length=1, max_length=500),
            "expected_version": _serializers.IntegerField(min_value=1),
        }


class AssignTaskInputSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'AssignTaskInput', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "user_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class CreateTaskSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'CreateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "title": _drf_runtime.ContractTextField(min_length=1, max_length=200),
            "effort": _serializers.IntegerField(required=False, min_value=0),
        }


class GetTasksBatchInputSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'GetTasksBatchInput', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "ids": _serializers.ListField(child=_drf_runtime.TypedValueField(_uuid.UUID), max_length=200),
        }


class PaymentEventSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'PaymentEvent', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "id_": _drf_runtime.ContractTextField(),
            "type_": _drf_runtime.ContractTextField(),
            "data": _serializers.JSONField(),
        }


class TaskQuerySerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'TaskQuery', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "text": _drf_runtime.ContractTextField(required=False, max_length=200),
            "states": _serializers.ListField(
                child=_drf_runtime.TypedValueField(_schemas.TaskState),
                required=False,
                max_length=3,
            ),
        }


class UpdatePreferencesSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'UpdatePreferences', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "locale": _drf_runtime.ContractTextField(required=False, min_length=2, max_length=35),
            "digest": _serializers.BooleanField(required=False),
        }


class UpdateTaskSerializer(_drf_runtime.ContractSerializer):
    """The fields of schema 'UpdateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "title": _drf_runtime.ContractTextField(required=False, min_length=1, max_length=200),
            "state": _drf_runtime.TypedValueField(_schemas.TaskState, required=False),
            "effort": _serializers.IntegerField(required=False, min_value=0),
            "expected_version": _serializers.IntegerField(min_value=1),
        }


class ArchiveTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'archiveTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class ArchiveTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'archiveTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class ArchiveTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'archiveTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": ArchiveTaskPathSerializer(),
            "headers": ArchiveTaskHeadersSerializer(),
            "body": ArchiveTaskSerializer(),
        }


class AssignTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'assignTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class AssignTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'assignTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class AssignTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'assignTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": AssignTaskPathSerializer(),
            "headers": AssignTaskHeadersSerializer(),
            "body": AssignTaskInputSerializer(),
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


class DeleteDraftPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'deleteDraft', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "draft_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class DeleteDraftHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'deleteDraft', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class DeleteDraftRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'deleteDraft', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": DeleteDraftPathSerializer(),
            "headers": DeleteDraftHeadersSerializer(),
        }


class GetChannelPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'getChannel', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class GetChannelRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getChannel', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": GetChannelPathSerializer(),
        }


class GetDraftPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'getDraft', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "draft_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class GetDraftRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getDraft', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": GetDraftPathSerializer(),
        }


class GetPreferencesHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'getPreferences', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "if_none_match": _drf_runtime.ContractTextField(required=False),
        }


class GetPreferencesRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getPreferences', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "headers": GetPreferencesHeadersSerializer(),
        }


class GetTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'getTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class GetTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": GetTaskPathSerializer(),
        }


class GetTasksBatchPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'getTasksBatch', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class GetTasksBatchRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'getTasksBatch', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": GetTasksBatchPathSerializer(),
            "body": GetTasksBatchInputSerializer(),
        }


class ListChannelsQuerySerializer(_drf_runtime.ContractSerializer):
    """The fields of the query of operation 'listChannels', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "cursor": _drf_runtime.ContractTextField(required=False),
            "limit": _serializers.IntegerField(required=False, min_value=1, max_value=100),
        }


class ListChannelsRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'listChannels', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "query": ListChannelsQuerySerializer(),
        }


class ListTasksPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'listTasks', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class ListTasksQuerySerializer(_drf_runtime.ContractSerializer):
    """The fields of the query of operation 'listTasks', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "cursor": _drf_runtime.ContractTextField(required=False),
            "limit": _serializers.IntegerField(required=False, min_value=1, max_value=50),
            "sort": _serializers.ListField(
                child=_drf_runtime.ContractTextField(validators=[_drf_runtime.pattern("^(?:createdAt|-createdAt)$")]),
                required=False,
            ),
        }


class ListTasksRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'listTasks', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": ListTasksPathSerializer(),
            "query": ListTasksQuerySerializer(),
        }


class PaymentsRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'payments', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "body": PaymentEventSerializer(),
        }


class PurgeTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'purgeTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class PurgeTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'purgeTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class PurgeTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'purgeTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": PurgeTaskPathSerializer(),
            "headers": PurgeTaskHeadersSerializer(),
            "body": ApiEmptyBodySerializer(),
        }


class SearchTasksPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'searchTasks', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class SearchTasksRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'searchTasks', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": SearchTasksPathSerializer(),
            "body": TaskQuerySerializer(),
        }


class UpdatePreferencesHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'updatePreferences', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class UpdatePreferencesRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'updatePreferences', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "headers": UpdatePreferencesHeadersSerializer(),
            "body": UpdatePreferencesSerializer(),
        }


class UpdateTaskPathSerializer(_drf_runtime.ContractSerializer):
    """The fields of the path of operation 'updateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "channel_id": _drf_runtime.TypedValueField(_uuid.UUID),
            "task_id": _drf_runtime.TypedValueField(_uuid.UUID),
        }


class UpdateTaskHeadersSerializer(_drf_runtime.ContractSerializer):
    """The fields of the headers of operation 'updateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "idempotency_key": _drf_runtime.ContractTextField(),
        }


class UpdateTaskRequestSerializer(_drf_runtime.ContractSerializer):
    """The fields of the input of operation 'updateTask', built in get_fields()."""

    def get_fields(self) -> _drf_runtime.SerializerFields:
        return {
            "path": UpdateTaskPathSerializer(),
            "headers": UpdateTaskHeadersSerializer(),
            "body": UpdateTaskSerializer(),
        }


def contract_exception_handler(
    exception: Exception, context: _abc.Mapping[str, object]
) -> _http.HttpResponseBase | None:
    """The exception handler of the contract views, never the app's EXCEPTION_HANDLER."""
    return _drf_runtime.contract_exception_reply("tasks", exception, context)


class TasksView(_drf_runtime.ContractView):
    """The base of the contract views of api 'tasks'."""

    api = "tasks"
    contract = _contract.CONTRACT
    credentials: _typing.ClassVar[_abc.Mapping[str, _drf_runtime.CredentialsType]] = {
        "stripe": _drf_runtime.CredentialsType(_operations.StripeCredentials, {"stripeSignature": "stripe_signature"}),
        "user": _drf_runtime.CredentialsType(
            _operations.UserCredentials, {"bearer": "bearer", "sessionCookie": "session_cookie"}
        ),
    }

    def get_exception_handler(self) -> _drf_runtime.ExceptionHandler:
        return contract_exception_handler


def _tasks_handlers(request: _http.HttpRequest) -> _operations.TasksEndpoints:
    built = _django_runtime.built_handlers("tasks", "tasks", request)

    if isinstance(built, _operations.TasksEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "tasks", "TasksEndpoints", built)


def _drafts_handlers(request: _http.HttpRequest) -> _operations.DraftsEndpoints:
    built = _django_runtime.built_handlers("tasks", "drafts", request)

    if isinstance(built, _operations.DraftsEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "drafts", "DraftsEndpoints", built)


def _channels_handlers(request: _http.HttpRequest) -> _operations.ChannelsEndpoints:
    built = _django_runtime.built_handlers("tasks", "channels", request)

    if isinstance(built, _operations.ChannelsEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "channels", "ChannelsEndpoints", built)


def _preferences_handlers(request: _http.HttpRequest) -> _operations.PreferencesEndpoints:
    built = _django_runtime.built_handlers("tasks", "preferences", request)

    if isinstance(built, _operations.PreferencesEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "preferences", "PreferencesEndpoints", built)


def _app_handlers(request: _http.HttpRequest) -> _operations.AppEndpoints:
    built = _django_runtime.built_handlers("tasks", "app", request)

    if isinstance(built, _operations.AppEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "app", "AppEndpoints", built)


def _hooks_handlers(request: _http.HttpRequest) -> _operations.HooksEndpoints:
    built = _django_runtime.built_handlers("tasks", "hooks", request)

    if isinstance(built, _operations.HooksEndpoints):
        return built

    raise _django_runtime.HandlersMismatchError("tasks", "hooks", "HooksEndpoints", built)


class HealthView(TasksView):
    """The contract path `/v1/health`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "health")
        contract_request = _operations.HealthRequest(input=admission.empty_input(_operations.HealthInput))

        return admission.reply(_app_handlers(request).health(contract_request))


class ListChannelsView(TasksView):
    """The contract path `/v1/channels`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "listChannels")
        contract_request = _operations.ListChannelsRequest(
            input=admission.input(ListChannelsRequestSerializer, _operations.ListChannelsInput),
            principal=admission.principal(_schemas.UserPrincipal),
        )

        return admission.reply(_channels_handlers(request).list_channels(contract_request))


class GetPreferencesView(TasksView):
    """The contract path `/v1/me/preferences`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getPreferences")
        contract_request = _operations.GetPreferencesRequest(
            input=admission.input(GetPreferencesRequestSerializer, _operations.GetPreferencesInput),
            principal=admission.principal(_schemas.UserPrincipal),
        )

        return admission.reply(_preferences_handlers(request).get_preferences(contract_request))

    def patch(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "updatePreferences")
        contract_request = _operations.UpdatePreferencesRequest(
            input=admission.input(UpdatePreferencesRequestSerializer, _operations.UpdatePreferencesInput),
            principal=admission.principal(_schemas.UserPrincipal),
        )

        return admission.reply(_preferences_handlers(request).update_preferences(contract_request))


class PaymentsView(TasksView):
    """The contract path `/v1/hooks/payments`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "payments")
        contract_request = _operations.PaymentsRequest(
            input=admission.input(PaymentsRequestSerializer, _operations.PaymentsInput),
            principal=admission.principal(_schemas.WebhookCaller),
        )

        return admission.reply(_hooks_handlers(request).payments(contract_request))


class DeleteDraftView(TasksView):
    """The contract path `/v1/me/drafts/{draftId}`."""

    def delete(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "deleteDraft")
        contract_request = _operations.DeleteDraftRequest(
            input=admission.input(DeleteDraftRequestSerializer, _operations.DeleteDraftInput),
            principal=admission.principal(_schemas.UserPrincipal),
        )

        return admission.reply(_drafts_handlers(request).delete_draft(contract_request))

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getDraft")
        contract_request = _operations.GetDraftRequest(
            input=admission.input(GetDraftRequestSerializer, _operations.GetDraftInput),
            principal=admission.principal(_schemas.UserPrincipal),
        )

        return admission.reply(_drafts_handlers(request).get_draft(contract_request))


class GetChannelView(TasksView):
    """The contract path `/v1/channels/{channelId}`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getChannel")
        contract_request = _operations.GetChannelRequest(
            input=admission.input(GetChannelRequestSerializer, _operations.GetChannelInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.GetChannelScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_channels_handlers(request).get_channel(contract_request))


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

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "listTasks")
        contract_request = _operations.ListTasksRequest(
            input=admission.input(ListTasksRequestSerializer, _operations.ListTasksInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.ListTasksScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).list_tasks(contract_request))


class GetTasksBatchView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/batch`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getTasksBatch")
        contract_request = _operations.GetTasksBatchRequest(
            input=admission.input(GetTasksBatchRequestSerializer, _operations.GetTasksBatchInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.GetTasksBatchScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).get_tasks_batch(contract_request))


class SearchTasksView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/search`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "searchTasks")
        contract_request = _operations.SearchTasksRequest(
            input=admission.input(SearchTasksRequestSerializer, _operations.SearchTasksInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.SearchTasksScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).search_tasks(contract_request))


class GetTaskView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/{taskId}`."""

    def get(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "getTask")
        contract_request = _operations.GetTaskRequest(
            input=admission.input(GetTaskRequestSerializer, _operations.GetTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.GetTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).get_task(contract_request))

    def patch(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "updateTask")
        contract_request = _operations.UpdateTaskRequest(
            input=admission.input(UpdateTaskRequestSerializer, _operations.UpdateTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.UpdateTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).update_task(contract_request))


class ArchiveTaskView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/{taskId}/archive`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "archiveTask")
        contract_request = _operations.ArchiveTaskRequest(
            input=admission.input(ArchiveTaskRequestSerializer, _operations.ArchiveTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.ArchiveTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).archive_task(contract_request))


class AssignTaskView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/{taskId}/assign`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "assignTask")
        contract_request = _operations.AssignTaskRequest(
            input=admission.input(AssignTaskRequestSerializer, _operations.AssignTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.AssignTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).assign_task(contract_request))


class PurgeTaskView(TasksView):
    """The contract path `/v1/channels/{channelId}/tasks/{taskId}/purge`."""

    def post(self, request: _request.Request, **path: str) -> _http.HttpResponseBase:
        admission = self.admit(request, "purgeTask")
        contract_request = _operations.PurgeTaskRequest(
            input=admission.input(PurgeTaskRequestSerializer, _operations.PurgeTaskInput),
            principal=admission.principal(_schemas.UserPrincipal),
            scopes=_operations.PurgeTaskScopes(channel=admission.scope("channel")),
        )

        return admission.reply(_tasks_handlers(request).purge_task(contract_request))
