"""The developer's handlers of every operation of the reference contract's apis, each answering the loaded script
when it says so, and the factories SEAMPACT names, which build them per request."""

import uuid

from django.http import HttpRequest
from generated.tasks import operations as tasks
from generated.tasks.schemas import Preferences, Task, TaskSearchResult, TaskState
from generated.tasks_absolute_urls import operations as absolute_urls
from generated.tasks_devices import operations as devices
from generated.tasks_devices.schemas import DeviceStatus
from generated.tasks_optional_auth import operations as optional_auth
from generated.tasks_optional_auth.schemas import Greeting
from generated.tasks_responses import operations as notes
from generated.tasks_responses.schemas import Note, NoteKey
from generated.tasks_service import operations as service
from generated.tasks_service_writes import operations as service_writes
from paged_lists import channel_page, note_page, sample_task_page, scripted_task_page
from sample_data import (
    FIRST_NOTE_ID,
    FIRST_VERSION,
    NEW_TASK_ID,
    channel,
    channel_of,
    draft,
    listed_tasks,
    loaded_channel,
    note,
    relayed_task,
    service_task,
    service_task_of,
    task,
    task_of,
    with_next_version,
)
from seampact_consumer_suite.log_lines import log_trace_context
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_OK: int = 200
_SERVICE_API: str = "tasksService"
_DEFAULT_LOCALE: str = "en"
_DEFAULT_DIGEST: bool = False
_RESPONSES_API: str = "tasksResponses"
_NOTE_ID: uuid.UUID = uuid.UUID("30000000-0000-4000-8000-000000000001")
_FIRST_REVISION: int = 1
_FIRST_NOTE_TEXT: str = "The first note"
_NOTE_SECRET: str = "note-secret"


class ChannelsHandlers:
    def get_channel(self, request: tasks.GetChannelRequest) -> tasks.GetChannelResult:
        caller_id = str(request.principal.user_id)

        return scripted_answer("getChannel", _OK, _channel_reply_of) or tasks.GetChannelResponse200(
            body=loaded_channel(request.scopes.channel, caller_id)
        )

    def list_channels(self, request: tasks.ListChannelsRequest) -> tasks.ListChannelsResult:
        return tasks.ListChannelsResponse200(body=channel_page([channel()]))


class DraftsHandlers:
    def get_draft(self, request: tasks.GetDraftRequest) -> tasks.GetDraftResult:
        return tasks.GetDraftResponse200(body=draft(request.input.path.draft_id))

    def delete_draft(self, request: tasks.DeleteDraftRequest) -> tasks.DeleteDraftResult:
        return tasks.DeleteDraftResponse200(body=draft(request.input.path.draft_id))


class HooksHandlers:
    def payments(self, request: tasks.PaymentsRequest) -> tasks.PaymentsResult:
        return tasks.PaymentsResponse204()


class PreferencesHandlers:
    def get_preferences(self, request: tasks.GetPreferencesRequest) -> tasks.GetPreferencesResult:
        return tasks.GetPreferencesResponse200(body=Preferences(locale=_DEFAULT_LOCALE, digest=_DEFAULT_DIGEST))

    def update_preferences(self, request: tasks.UpdatePreferencesRequest) -> tasks.UpdatePreferencesResult:
        body = request.input.body
        preferences = Preferences(locale=body.locale or _DEFAULT_LOCALE, digest=body.digest)

        return tasks.UpdatePreferencesResponse200(body=preferences)


class TasksHandlers:
    def get_task(self, request: tasks.GetTaskRequest) -> tasks.GetTaskResult:
        not_found = {"api.not_found": tasks.GetTaskErrors.api_not_found}

        return scripted_answer("getTask", _OK, _task_reply_of, not_found) or tasks.GetTaskResponse200(
            body=task(request.input.path.task_id)
        )

    def get_tasks_batch(self, request: tasks.GetTasksBatchRequest) -> tasks.GetTasksBatchResult:
        return tasks.GetTasksBatchResponse200(body={str(task_id): task(task_id) for task_id in request.input.body.ids})

    def create_task(self, request: tasks.CreateTaskRequest) -> tasks.CreateTaskResult:
        created = task(NEW_TASK_ID)

        return tasks.CreateTaskResponse201(body=_retitled(created, request.input.body.title))

    def update_task(self, request: tasks.UpdateTaskRequest) -> tasks.UpdateTaskResult:
        body = request.input.body

        # Every task is at its first version, so another expected version is stale.
        if body.expected_version != FIRST_VERSION:
            return tasks.UpdateTaskErrors.state_conflict()

        current = task(request.input.path.task_id)

        return tasks.UpdateTaskResponse200(body=with_next_version(current, body.title or current.title, current.state))

    def assign_task(self, request: tasks.AssignTaskRequest) -> tasks.AssignTaskResult:
        return tasks.AssignTaskResponse200(body=task(request.input.path.task_id))

    def archive_task(self, request: tasks.ArchiveTaskRequest) -> tasks.ArchiveTaskResult:
        if request.input.body.expected_version != FIRST_VERSION:
            return tasks.ArchiveTaskErrors.state_conflict()

        current = task(request.input.path.task_id)

        return tasks.ArchiveTaskResponse200(body=with_next_version(current, current.title, TaskState.ARCHIVED))

    def purge_task(self, request: tasks.PurgeTaskRequest) -> tasks.PurgeTaskResult:
        return tasks.PurgeTaskResponse204()

    def list_tasks(self, request: tasks.ListTasksRequest) -> tasks.ListTasksResult:
        page = sample_task_page(listed_tasks(request.input.query.state), request.input)

        return scripted_answer("listTasks", _OK, _task_page_of) or tasks.ListTasksResponse200(body=page)

    def search_tasks(self, request: tasks.SearchTasksRequest) -> tasks.SearchTasksResult:
        return tasks.SearchTasksResponse200(body=TaskSearchResult(items=[task(NEW_TASK_ID)], total=1))


class InternalHandlers:
    """The `tasksService` api's handlers; the boundary refuses a request whose deadline has passed."""

    def get_task(self, request: service.GetTaskRequest) -> service.GetTaskResult:
        log_trace_context(request.input.headers.traceparent)
        reply = scripted_answer("getTask", _OK, _service_task_reply_of, api=_SERVICE_API)

        return reply or service.GetTaskResponse200(body=service_task(request.input.path.task_id))


class InternalWritesHandlers:
    """The `tasksServiceWrites` api's handlers: the relayed write creates the task it is given."""

    def create_task(self, request: service_writes.CreateTaskRequest) -> service_writes.CreateTaskResult:
        body = request.input.body

        return service_writes.CreateTaskResponse201(body=relayed_task(body.title, body.effort))


class DevicesHandlers:
    """The `tasksDevices` api's handlers: the status of the device the boundary authenticated."""

    def status(self, request: devices.StatusRequest) -> devices.StatusResult:
        return devices.StatusResponse200(body=DeviceStatus(device_id=request.principal.device_id))


class WelcomeHandlers:
    """The `tasksOptionalAuth` api's handlers: a caller is signed in when the boundary hands it a principal."""

    def greeting(self, request: optional_auth.GreetingRequest) -> optional_auth.GreetingResult:
        return optional_auth.GreetingResponse200(body=Greeting(signed_in=request.principal is not None))

    def strict_greeting(self, request: optional_auth.StrictGreetingRequest) -> optional_auth.StrictGreetingResult:
        return optional_auth.StrictGreetingResponse200(body=Greeting(signed_in=request.principal is not None))


class NotesHandlers:
    """The `tasksAbsoluteUrls` api's handlers; the boundary writes their page links from the public origin."""

    def list_notes(self, request: absolute_urls.ListNotesRequest) -> absolute_urls.ListNotesResult:
        return absolute_urls.ListNotesResponse200(body=note_page([note(FIRST_NOTE_ID)], request.input))

    def get_note(self, request: absolute_urls.GetNoteRequest) -> absolute_urls.GetNoteResult:
        return absolute_urls.GetNoteResponse200(body=note(request.input.path.note_id))


def _channel_reply_of(body: dict[str, object]) -> tasks.GetChannelResult:
    return tasks.GetChannelResponse200(body=channel_of(body))


def _task_reply_of(body: dict[str, object]) -> tasks.GetTaskResult:
    return tasks.GetTaskResponse200(body=task_of(body))


def _service_task_reply_of(body: dict[str, object]) -> service.GetTaskResult:
    return service.GetTaskResponse200(body=service_task_of(body))


def _task_page_of(body: dict[str, object]) -> tasks.ListTasksResult:
    items = body.get("items")
    scripted_tasks = [task_of(item) for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    return tasks.ListTasksResponse200(body=scripted_task_page(scripted_tasks, body))


def _retitled(created: Task, title: str) -> Task:
    return Task(
        task_id=created.task_id,
        title=title,
        state=created.state,
        effort=created.effort,
        version=created.version,
        created_at=created.created_at,
    )


def _first_note(note_id: uuid.UUID, text: str = _FIRST_NOTE_TEXT) -> Note:
    return Note(note_id=note_id, text=text, revision=_FIRST_REVISION)


def _note_key_reply_of(body: dict[str, object]) -> notes.KeyNoteResult:
    return notes.KeyNoteResponse200(
        body=NoteKey(note_id=uuid.UUID(text_member(body, "noteId")), secret=text_member(body, "secret"))
    )


class ResponsesHandlers:
    """The `tasksResponses` api's public digest."""

    def digest(self, request: notes.DigestRequest) -> notes.DigestResult:
        return notes.DigestResponse200(body=_first_note(_NOTE_ID, "Today's digest"))


class ResponsesNotesHandlers:
    """The `tasksResponses` api's notes: one note at its first revision, saved as 200 when it exists and 201
    otherwise, and the If-Match comparison the boundary leaves to the handler."""

    def get_note(self, request: notes.GetNoteRequest) -> notes.GetNoteResult:
        return notes.GetNoteResponse200(body=_first_note(request.input.path.note_id))

    def update_note(self, request: notes.UpdateNoteRequest) -> notes.UpdateNoteResult:
        # The boundary hands the If-Match version unquoted.
        if request.input.headers.if_match != str(_FIRST_REVISION):
            return notes.UpdateNoteErrors.api_precondition_failed()

        path = request.input.path

        return notes.UpdateNoteResponse200(
            body=Note(note_id=path.note_id, text=request.input.body.text, revision=_FIRST_REVISION + 1)
        )

    def save_note(self, request: notes.SaveNoteRequest) -> notes.SaveNoteResult:
        note_id = request.input.path.note_id
        saved = _first_note(note_id, request.input.body.text)

        return notes.SaveNoteResponse200(body=saved) if note_id == _NOTE_ID else notes.SaveNoteResponse201(body=saved)

    def key_note(self, request: notes.KeyNoteRequest) -> notes.KeyNoteResult:
        reply = scripted_answer("keyNote", _OK, _note_key_reply_of, api=_RESPONSES_API)

        return reply or notes.KeyNoteResponse200(body=NoteKey(note_id=request.input.path.note_id, secret=_NOTE_SECRET))

    def legacy_note(self, request: notes.LegacyNoteRequest) -> notes.LegacyNoteResult:
        return notes.LegacyNoteResponse200(body=_first_note(request.input.path.note_id))
def channels_handlers(request: HttpRequest) -> ChannelsHandlers:
    return ChannelsHandlers()


def drafts_handlers(request: HttpRequest) -> DraftsHandlers:
    return DraftsHandlers()


def hooks_handlers(request: HttpRequest) -> HooksHandlers:
    return HooksHandlers()


def preferences_handlers(request: HttpRequest) -> PreferencesHandlers:
    return PreferencesHandlers()


def tasks_handlers(request: HttpRequest) -> TasksHandlers:
    return TasksHandlers()


def internal_handlers(request: HttpRequest) -> InternalHandlers:
    return InternalHandlers()


def internal_writes_handlers(request: HttpRequest) -> InternalWritesHandlers:
    return InternalWritesHandlers()


def devices_handlers(request: HttpRequest) -> DevicesHandlers:
    return DevicesHandlers()


def welcome_handlers(request: HttpRequest) -> WelcomeHandlers:
    return WelcomeHandlers()


def notes_handlers(request: HttpRequest) -> NotesHandlers:
    return NotesHandlers()


def responses_handlers(request: HttpRequest) -> ResponsesHandlers:
    return ResponsesHandlers()


def responses_notes_handlers(request: HttpRequest) -> ResponsesNotesHandlers:
    return ResponsesNotesHandlers()
