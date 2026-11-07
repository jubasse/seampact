"""The request factories of the shared paging handlers and `user` hook double, which the Django consumers (DRF and,
copied in, Django Ninja) name for the `tasksPaging` and `tasksSplitSort` apis."""

from django.http import HttpRequest
from hook_doubles import TasksUnexpectedErrors
from paging_doubles import PagingCappedHandlers, PagingNotesHandlers, PagingUserHook, SplitSortNotesHandlers


def paging_notes_handlers(request: HttpRequest) -> PagingNotesHandlers:
    return PagingNotesHandlers()


def paging_capped_handlers(request: HttpRequest) -> PagingCappedHandlers:
    return PagingCappedHandlers()


def split_sort_notes_handlers(request: HttpRequest) -> SplitSortNotesHandlers:
    return SplitSortNotesHandlers()


def paging_user_hook(request: HttpRequest) -> PagingUserHook:
    return PagingUserHook()


def paging_unexpected_errors(request: HttpRequest) -> TasksUnexpectedErrors:
    return TasksUnexpectedErrors()
