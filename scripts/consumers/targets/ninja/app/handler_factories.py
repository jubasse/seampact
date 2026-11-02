"""The handler factories `bind_tasks()` and `bind_tasks_service()` take: each builds the shared handlers of
`handlers.py` per request. The drafts handlers answer `getDraft` with a plain `def`, which sync views require."""

from django.http import HttpRequest
from generated.tasks.operations import GetDraftRequest, GetDraftResponse200, GetDraftResult
from handlers import (
    AppHandlers,
    ChannelsHandlers,
    DraftsHandlers,
    HooksHandlers,
    InternalHandlers,
    PreferencesHandlers,
    TasksHandlers,
)
from sample_data import draft


class SyncDraftsHandlers(DraftsHandlers):
    def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return GetDraftResponse200(draft(str(request.input.path.draft_id)))


def app_handlers(request: HttpRequest) -> AppHandlers:
    return AppHandlers()


def channels_handlers(request: HttpRequest) -> ChannelsHandlers:
    return ChannelsHandlers()


def drafts_handlers(request: HttpRequest) -> SyncDraftsHandlers:
    return SyncDraftsHandlers()


def hooks_handlers(request: HttpRequest) -> HooksHandlers:
    return HooksHandlers()


def preferences_handlers(request: HttpRequest) -> PreferencesHandlers:
    return PreferencesHandlers()


def tasks_handlers(request: HttpRequest) -> TasksHandlers:
    return TasksHandlers()


def internal_handlers(request: HttpRequest) -> InternalHandlers:
    return InternalHandlers()
