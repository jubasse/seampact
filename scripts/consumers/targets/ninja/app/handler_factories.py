"""The handler factories the `bind_*()` functions take: each builds the shared handlers of
`handlers.py` or `responses_handlers.py` per request. The drafts handlers answer `getDraft` with a plain `def`, which sync views require."""

from django.http import HttpRequest
from generated.tasks.operations import GetDraftRequest, GetDraftResponse200, GetDraftResult
from handlers import (
    ChannelsHandlers,
    DevicesHandlers,
    DraftsHandlers,
    HooksHandlers,
    InternalHandlers,
    InternalWritesHandlers,
    NotesHandlers,
    PreferencesHandlers,
    TasksHandlers,
    WelcomeHandlers,
)
from responses_handlers import NotesHandlers as ResponsesNotesHandlers
from responses_handlers import ResponsesHandlers
from sample_data import draft


class SyncDraftsHandlers(DraftsHandlers):
    def get_draft(self, request: GetDraftRequest) -> GetDraftResult:
        return GetDraftResponse200(draft(str(request.input.path.draft_id)))


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
