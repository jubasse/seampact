"""The developer's handlers of the `tasks` and `tasksService` apis, each answering the loaded script when it says
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
    DeleteDraftErrors,
    DeleteDraftRequest,
    DeleteDraftResponse200,
    DeleteDraftResult,
    GetChannelRequest,
    GetChannelResponse200,
    GetChannelResult,
    GetDraftErrors,
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
    HealthRequest,
    HealthResponse200,
    HealthResult,
    ListChannelsPage,
    ListChannelsRequest,
    ListChannelsResponse200,
    ListChannelsResult,
    ListTasksPage,
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
from generated.tasks.schemas import Health, Preferences, TaskSearchResult, TaskState
from generated.tasks_service import operations as service
from sample_data import (
    FIRST_VERSION,
    GENERAL_CHANNEL_ID,
    NEW_TASK_ID,
    channel,
    channel_of,
    draft,
    loaded_channel,
    service_task,
    service_task_of,
    task,
    task_of,
    with_next_version,
)
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_OK: int = 200
_HEALTHY: str = "ok"
_NEXT_CURSOR: str = "page-2"
_DEFAULT_LOCALE: str = "en"
_NOT_FOUND: str = "api.not_found"
_SERVICE_API: str = "tasksService"


def _health_of(body: dict[str, object]) -> HealthResult:
    return HealthResponse200(Health(status=text_member(body, "status")))


def _channel_reply_of(body: dict[str, object]) -> GetChannelResult:
    return GetChannelResponse200(channel_of(body))


def answer_get_draft(request: GetDraftRequest) -> GetDraftResult:
    """The `getDraft` answer of the loaded script, else the caller's draft; FastAPI and Ninja handlers share it."""
    return scripted_answer(
        "getDraft", _OK, _draft_reply_of, {_NOT_FOUND: GetDraftErrors.api_not_found}
    ) or GetDraftResponse200(draft(str(request.input.path.draft_id)))


def _draft_reply_of(body: dict[str, object]) -> GetDraftResult:
    return GetDraftResponse200(draft(text_member(body, "draftId")))


def _deleted_draft_reply_of(body: dict[str, object]) -> DeleteDraftResult:
    return DeleteDraftResponse200(draft(text_member(body, "draftId")))


def _task_reply_of(body: dict[str, object]) -> GetTaskResult:
    return GetTaskResponse200(task_of(body))


def _service_task_reply_of(body: dict[str, object]) -> service.GetTaskResult:
    return service.GetTaskResponse200(service_task_of(body))


def _page_of(body: dict[str, object]) -> ListTasksResult:
    items = body.get("items")
    next_cursor = body.get("nextCursor")
    tasks = [task_of(item) for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    return ListTasksResponse200(
        ListTasksPage(items=tasks, next_cursor=next_cursor if isinstance(next_cursor, str) else None)
    )


class AppHandlers:
    def health(self, request: HealthRequest) -> HealthResult:
        return scripted_answer("health", _OK, _health_of) or HealthResponse200(Health(status=_HEALTHY))


class ChannelsHandlers:
    def get_channel(self, request: GetChannelRequest) -> GetChannelResult:
        caller_id = str(request.principal.user_id)

        return scripted_answer("getChannel", _OK, _channel_reply_of) or GetChannelResponse200(
            loaded_channel(request.scopes.channel, caller_id)
        )

    def list_channels(self, request: ListChannelsRequest) -> ListChannelsResult:
        return ListChannelsResponse200(ListChannelsPage(items=[channel(GENERAL_CHANNEL_ID)]))


class DraftsHandlers:
    async def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return answer_get_draft(request)

    def delete_draft(self, request: DeleteDraftRequest) -> DeleteDraftResult:
        return scripted_answer(
            "deleteDraft", _OK, _deleted_draft_reply_of, {_NOT_FOUND: DeleteDraftErrors.api_not_found}
        ) or DeleteDraftResponse200(draft(str(request.input.path.draft_id)))


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

    # The first page links a second one; the second is the last.
    def list_tasks(self, request: ListTasksRequest) -> ListTasksResult:
        next_cursor = _NEXT_CURSOR if request.input.query.cursor is None else None

        return scripted_answer("listTasks", _OK, _page_of) or ListTasksResponse200(
            ListTasksPage(items=[task(NEW_TASK_ID)], next_cursor=next_cursor)
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
