"""The developer's handlers of every api of the reference contract, each answering the loaded script when it says
so."""

from datetime import UTC, datetime

from generated.tasks.operations import (
    ArchiveTaskErrors,
    ArchiveTaskRequest,
    ArchiveTaskResponse200,
    ArchiveTaskResult,
    AssignTaskRequest,
    AssignTaskResponse200,
    AssignTaskResult,
    CreateTaskRequest,
    CreateTaskResponse201,
    CreateTaskResult,
    DeleteDraftRequest,
    DeleteDraftResponse200,
    DeleteDraftResult,
    GetChannelRequest,
    GetChannelResponse200,
    GetChannelResult,
    GetDraftRequest,
    GetDraftResponse200,
    GetDraftResult,
    GetPreferencesRequest,
    GetPreferencesResponse200,
    GetPreferencesResult,
    GetTaskErrors,
    GetTaskRequest,
    GetTaskResponse200,
    GetTaskResult,
    GetTasksBatchRequest,
    GetTasksBatchResponse200,
    GetTasksBatchResult,
    ListChannelsRequest,
    ListChannelsResponse200,
    ListChannelsResult,
    ListTasksRequest,
    ListTasksResponse200,
    ListTasksResult,
    PaymentsRequest,
    PaymentsResponse204,
    PaymentsResult,
    PurgeTaskRequest,
    PurgeTaskResponse204,
    PurgeTaskResult,
    SearchTasksRequest,
    SearchTasksResponse200,
    SearchTasksResult,
    UpdatePreferencesRequest,
    UpdatePreferencesResponse200,
    UpdatePreferencesResult,
    UpdateTaskErrors,
    UpdateTaskRequest,
    UpdateTaskResponse200,
    UpdateTaskResult,
)
from generated.tasks.schemas import Preferences, TaskSearchResult, TaskState
from generated.tasks_absolute_urls import operations as absolute_urls
from generated.tasks_devices import operations as devices
from generated.tasks_devices.schemas import DeviceStatus
from generated.tasks_optional_auth import operations as optional_auth
from generated.tasks_optional_auth.schemas import Greeting
from generated.tasks_service import operations as service
from generated.tasks_service_writes import operations as service_writes
from paged_lists import channel_page, note_page, sample_task_page, scripted_task_page
from sample_data import (
    FIRST_NOTE_ID,
    FIRST_VERSION,
    GENERAL_CHANNEL_ID,
    NEW_TASK_ID,
    channel,
    channel_of,
    draft,
    loaded_channel,
    note,
    relayed_task,
    service_task,
    service_task_of,
    task,
    task_of,
    with_next_version,
)
from seampact_consumer_suite.scripted_answers import scripted_answer

_OK: int = 200
_DEFAULT_LOCALE: str = "en"
_NOT_FOUND: str = "api.not_found"
_SERVICE_API: str = "tasksService"


def _channel_reply_of(body: dict[str, object]) -> GetChannelResult:
    return GetChannelResponse200(channel_of(body))


def _task_reply_of(body: dict[str, object]) -> GetTaskResult:
    return GetTaskResponse200(task_of(body))


def _service_task_reply_of(body: dict[str, object]) -> service.GetTaskResult:
    return service.GetTaskResponse200(service_task_of(body))


def _page_of(body: dict[str, object]) -> ListTasksResult:
    items = body.get("items")
    tasks = [task_of(item) for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    return ListTasksResponse200(scripted_task_page(tasks, body))


class ChannelsHandlers:
    def get_channel(self, request: GetChannelRequest) -> GetChannelResult:
        caller_id = str(request.principal.user_id)

        return scripted_answer("getChannel", _OK, _channel_reply_of) or GetChannelResponse200(
            loaded_channel(request.scopes.channel, caller_id)
        )

    def list_channels(self, request: ListChannelsRequest) -> ListChannelsResult:
        return ListChannelsResponse200(channel_page([channel(GENERAL_CHANNEL_ID)]))


class DraftsHandlers:
    async def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return GetDraftResponse200(draft(str(request.input.path.draft_id)))

    def delete_draft(self, request: DeleteDraftRequest) -> DeleteDraftResult:
        return DeleteDraftResponse200(draft(str(request.input.path.draft_id)))


class PreferencesHandlers:
    def get_preferences(self, request: GetPreferencesRequest) -> GetPreferencesResult:
        return GetPreferencesResponse200(Preferences(locale=_DEFAULT_LOCALE, digest=False))

    def update_preferences(self, request: UpdatePreferencesRequest) -> UpdatePreferencesResult:
        body = request.input.body

        return UpdatePreferencesResponse200(Preferences(locale=body.locale or _DEFAULT_LOCALE, digest=body.digest))


class HooksHandlers:
    def payments(self, request: PaymentsRequest) -> PaymentsResult:
        return PaymentsResponse204()


class TasksHandlers:
    def get_task(self, request: GetTaskRequest) -> GetTaskResult:
        return scripted_answer(
            "getTask", _OK, _task_reply_of, {_NOT_FOUND: GetTaskErrors.api_not_found}
        ) or GetTaskResponse200(task(str(request.input.path.task_id)))

    def get_tasks_batch(self, request: GetTasksBatchRequest) -> GetTasksBatchResult:
        return GetTasksBatchResponse200({str(task_id): task(str(task_id)) for task_id in request.input.body.ids})

    def create_task(self, request: CreateTaskRequest) -> CreateTaskResult:
        created = task(NEW_TASK_ID).model_copy(update={"title": request.input.body.title})

        return CreateTaskResponse201(created)

    def update_task(self, request: UpdateTaskRequest) -> UpdateTaskResult:
        body = request.input.body

        # Every task is at its first version, so another expected version is stale.
        if body.expected_version != FIRST_VERSION:
            return UpdateTaskErrors.state_conflict()

        current = task(str(request.input.path.task_id))

        return UpdateTaskResponse200(with_next_version(current, body.title or current.title, current.state))

    def assign_task(self, request: AssignTaskRequest) -> AssignTaskResult:
        return AssignTaskResponse200(task(str(request.input.path.task_id)))

    def archive_task(self, request: ArchiveTaskRequest) -> ArchiveTaskResult:
        if request.input.body.expected_version != FIRST_VERSION:
            return ArchiveTaskErrors.state_conflict()

        current = task(str(request.input.path.task_id))

        return ArchiveTaskResponse200(with_next_version(current, current.title, TaskState.ARCHIVED))

    def purge_task(self, request: PurgeTaskRequest) -> PurgeTaskResult:
        return PurgeTaskResponse204()

    def list_tasks(self, request: ListTasksRequest) -> ListTasksResult:
        return scripted_answer("listTasks", _OK, _page_of) or ListTasksResponse200(
            sample_task_page([task(NEW_TASK_ID)], request.input)
        )

    def search_tasks(self, request: SearchTasksRequest) -> SearchTasksResult:
        return SearchTasksResponse200(TaskSearchResult(items=[task(NEW_TASK_ID)], total=1))


class InternalHandlers:
    """The `tasksService` api's handlers; the boundary refuses a request whose deadline has passed, and the handler
    refuses one that passes while it works."""

    def get_task(self, request: service.GetTaskRequest) -> service.GetTaskResult:
        deadline = request.deadline

        if deadline is not None and deadline.has_passed(datetime.now(UTC)):
            return service.GetTaskErrors.api_deadline_exceeded()

        reply = scripted_answer("getTask", _OK, _service_task_reply_of, api=_SERVICE_API)

        return reply or service.GetTaskResponse200(service_task(str(request.input.path.task_id)))


class InternalWritesHandlers:
    """The `tasksServiceWrites` api's handlers: the relayed write creates the task it is given."""

    def create_task(self, request: service_writes.CreateTaskRequest) -> service_writes.CreateTaskResult:
        body = request.input.body

        return service_writes.CreateTaskResponse201(relayed_task(body.title, body.effort))


class DevicesHandlers:
    """The `tasksDevices` api's handlers: the status of the device the boundary authenticated."""

    def status(self, request: devices.StatusRequest) -> devices.StatusResult:
        return devices.StatusResponse200(DeviceStatus(device_id=request.principal.device_id))


class WelcomeHandlers:
    """The `tasksOptionalAuth` api's handlers: a caller is signed in when the boundary hands it a principal."""

    def greeting(self, request: optional_auth.GreetingRequest) -> optional_auth.GreetingResult:
        return optional_auth.GreetingResponse200(Greeting(signed_in=request.principal is not None))

    def strict_greeting(self, request: optional_auth.StrictGreetingRequest) -> optional_auth.StrictGreetingResult:
        return optional_auth.StrictGreetingResponse200(Greeting(signed_in=request.principal is not None))


class NotesHandlers:
    """The `tasksAbsoluteUrls` api's handlers; the boundary writes their page links from the public origin."""

    def list_notes(self, request: absolute_urls.ListNotesRequest) -> absolute_urls.ListNotesResult:
        return absolute_urls.ListNotesResponse200(note_page([note(FIRST_NOTE_ID)], request.input))

    def get_note(self, request: absolute_urls.GetNoteRequest) -> absolute_urls.GetNoteResult:
        return absolute_urls.GetNoteResponse200(note(str(request.input.path.note_id)))
