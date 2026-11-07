"""The framework-free handlers and `user` hook double of the reference contract's `tasksPaging` and `tasksSplitSort`
apis, which the Python consumers bind beside the main two: a Stripe-style list with its more flag, a clamped list whose
note's text tells the limit the handler received, and GitHub-style pages whose note's text tells the sort and the page
size the handler received, so a case reads them on the wire."""

import uuid
from datetime import datetime
from typing import Final

from generated.tasks_paging import operations as paging
from generated.tasks_paging import schemas as paging_schemas
from generated.tasks_split_sort import operations as split_sort
from generated.tasks_split_sort import schemas as split_sort_schemas
from hook_doubles import UNAUTHENTICATED, user_id_of
from seampact_consumer_suite.control_state import record_hook_call
from seampact_consumer_suite.scripted_answers import raise_scripted_hook_failure

from seampact.hooks import AuthenticateRequest, AuthenticateResult, ErrorCodeWithParams, authenticate_result

FIRST_NOTE_ID: Final = "30000000-0000-4000-8000-000000000001"
SECOND_NOTE_ID: Final = "30000000-0000-4000-8000-000000000002"
CREATED: Final = datetime.fromisoformat("2026-10-18T09:00:00Z")
# Three pages of 100, so a page size above the maximum served as sent would link no next page.
SPLIT_SORT_TOTAL: Final = 250
ABSENT: Final = "none"


def _paging_note(note_id: str, text: str) -> paging_schemas.Note:
    return paging_schemas.Note(note_id=uuid.UUID(note_id), text=text)


class PagingNotesHandlers:
    """The `tasksPaging` api's Stripe-style list: the first note with more to come, then the second one, the last, and
    the first one again before the second."""

    def list_notes(self, request: paging.ListNotesRequest) -> paging.ListNotesResult:
        if request.input.query.ending_before == SECOND_NOTE_ID:
            return paging.ListNotesResponse200(
                body=paging.ListNotesPage(items=[_paging_note(FIRST_NOTE_ID, "Before the second note")], more=False)
            )

        if request.input.query.starting_after == FIRST_NOTE_ID:
            return paging.ListNotesResponse200(
                body=paging.ListNotesPage(items=[_paging_note(SECOND_NOTE_ID, "Second note")], more=False)
            )

        return paging.ListNotesResponse200(
            body=paging.ListNotesPage(items=[_paging_note(FIRST_NOTE_ID, "First note")], more=True)
        )


class PagingCappedHandlers:
    """The `tasksPaging` api's clamped list: one note whose text tells the limit the handler received."""

    def list_capped(self, request: paging.ListCappedRequest) -> paging.ListCappedResult:
        limit = request.input.query.limit
        text = f"limit {ABSENT if limit is None else limit}"

        return paging.ListCappedResponse200(
            body=paging.ListCappedPage(items=[_paging_note(FIRST_NOTE_ID, text)], more=False)
        )


class SplitSortNotesHandlers:
    """The `tasksSplitSort` api's GitHub-style pages, whose note's text tells the sort and the page size received."""

    def list_notes(self, request: split_sort.ListNotesRequest) -> split_sort.ListNotesResult:
        query = request.input.query
        per_page = ABSENT if query.per_page is None else str(query.per_page)
        text = f"{query.sort or ABSENT} {query.direction or ABSENT}, {per_page} per page"
        note = split_sort_schemas.Note(note_id=uuid.UUID(FIRST_NOTE_ID), text=text, created=CREATED)

        return split_sort.ListNotesResponse200(body=split_sort.ListNotesPage(items=[note], total=SPLIT_SORT_TOTAL))


class PagingUserHook:
    """The `user` identity of both apis: a bearer token of the credentials, or the same token as the session cookie."""

    def authenticate(self, request: AuthenticateRequest) -> AuthenticateResult:
        record_hook_call("authenticate:user", request.operation.api, request.operation.id)
        raise_scripted_hook_failure("authenticate:user")
        credentials = request.credentials
        token = (
            credentials.bearer or credentials.session_cookie
            if isinstance(credentials, paging.UserCredentials | split_sort.UserCredentials)
            else None
        )
        user_id = None if token is None else user_id_of(token)

        if user_id is None:
            return authenticate_result.Denied(deny=ErrorCodeWithParams(code=UNAUTHENTICATED))

        if isinstance(credentials, split_sort.UserCredentials):
            return authenticate_result.Authenticated(
                principal=split_sort_schemas.UserPrincipal(user_id=uuid.UUID(user_id))
            )

        return authenticate_result.Authenticated(principal=paging_schemas.UserPrincipal(user_id=uuid.UUID(user_id)))
