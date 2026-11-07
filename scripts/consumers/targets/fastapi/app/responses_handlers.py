"""The `tasksResponses` api's handlers, which the FastAPI and Ninja consumers bind beside their other apis: one note
at its first revision, saved as 200 when it exists and 201 otherwise, and the If-Match comparison the boundary leaves
to the handler; one memo at its first version, which a delete with another expected version leaves."""

import uuid
from typing import Final

from generated.tasks_responses.operations import (
    DeleteMemoErrors,
    DeleteMemoRequest,
    DeleteMemoResponse204,
    DeleteMemoResult,
    DigestRequest,
    DigestResponse200,
    DigestResult,
    GetMemoRequest,
    GetMemoResponse200,
    GetMemoResult,
    GetNoteRequest,
    GetNoteResponse200,
    GetNoteResult,
    KeyNoteRequest,
    KeyNoteResponse200,
    KeyNoteResult,
    LegacyNoteRequest,
    LegacyNoteResponse200,
    LegacyNoteResult,
    SaveNoteRequest,
    SaveNoteResponse200,
    SaveNoteResponse201,
    SaveNoteResult,
    UpdateNoteErrors,
    UpdateNoteRequest,
    UpdateNoteResponse200,
    UpdateNoteResult,
)
from generated.tasks_responses.schemas import Memo, Note, NoteKey
from seampact_consumer_suite.scripted_answers import scripted_answer, text_member

_API: Final = "tasksResponses"
_OK: Final = 200
NOTE_ID: Final = uuid.UUID("30000000-0000-4000-8000-000000000001")
_FIRST_REVISION: Final = 1
_FIRST_NOTE_TEXT: Final = "The first note"
_NOTE_SECRET: Final = "note-secret"
_FIRST_MEMO_VERSION: Final = 1
_FIRST_MEMO_TEXT: Final = "The first memo"


def _first_note(note_id: uuid.UUID, text: str = _FIRST_NOTE_TEXT) -> Note:
    return Note(note_id=note_id, text=text, revision=_FIRST_REVISION)


def _note_key_reply_of(body: dict[str, object]) -> KeyNoteResult:
    return KeyNoteResponse200(
        NoteKey(note_id=uuid.UUID(text_member(body, "noteId")), secret=text_member(body, "secret"))
    )


class ResponsesHandlers:
    def digest(self, request: DigestRequest) -> DigestResult:
        return DigestResponse200(_first_note(NOTE_ID, "Today's digest"))


class NotesHandlers:
    def get_note(self, request: GetNoteRequest) -> GetNoteResult:
        return GetNoteResponse200(_first_note(request.input.path.note_id))

    def update_note(self, request: UpdateNoteRequest) -> UpdateNoteResult:
        # The boundary hands the If-Match version unquoted.
        if request.input.headers.if_match != str(_FIRST_REVISION):
            return UpdateNoteErrors.api_precondition_failed()

        path = request.input.path

        return UpdateNoteResponse200(
            Note(note_id=path.note_id, text=request.input.body.text, revision=_FIRST_REVISION + 1)
        )

    def save_note(self, request: SaveNoteRequest) -> SaveNoteResult:
        note_id = request.input.path.note_id
        saved = _first_note(note_id, request.input.body.text)

        return SaveNoteResponse200(saved) if note_id == NOTE_ID else SaveNoteResponse201(saved)

    def key_note(self, request: KeyNoteRequest) -> KeyNoteResult:
        reply = scripted_answer("keyNote", _OK, _note_key_reply_of, api=_API)

        return reply or KeyNoteResponse200(NoteKey(note_id=request.input.path.note_id, secret=_NOTE_SECRET))

    def legacy_note(self, request: LegacyNoteRequest) -> LegacyNoteResult:
        return LegacyNoteResponse200(_first_note(request.input.path.note_id))


class MemosHandlers:
    def get_memo(self, request: GetMemoRequest) -> GetMemoResult:
        memo_id = request.input.path.memo_id

        return GetMemoResponse200(Memo(memo_id=memo_id, text=_FIRST_MEMO_TEXT, version=_FIRST_MEMO_VERSION))

    def delete_memo(self, request: DeleteMemoRequest) -> DeleteMemoResult:
        if request.input.query.expected_version != _FIRST_MEMO_VERSION:
            return DeleteMemoErrors.state_conflict()

        return DeleteMemoResponse204()
