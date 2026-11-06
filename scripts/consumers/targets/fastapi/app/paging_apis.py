"""Binds the reference contract's `tasksPaging` and `tasksSplitSort` apis on the FastAPI app, with the shared paging
handlers and `user` hook double."""

from typing import Final

from fastapi import FastAPI
from generated.tasks_paging.fastapi import TasksPagingHandlerFactories, bind_tasks_paging
from generated.tasks_split_sort.fastapi import TasksSplitSortHandlerFactories, bind_tasks_split_sort
from hook_doubles import TasksUnexpectedErrors
from paging_doubles import PagingNotesHandlers, PagingUserHook, SplitSortNotesHandlers

USER_IDENTITY: Final = "user"


def bind_paging_apis(app: FastAPI) -> None:
    bind_tasks_paging(
        app,
        handlers=TasksPagingHandlerFactories(notes=PagingNotesHandlers),
        authenticate={USER_IDENTITY: PagingUserHook},
        on_unexpected_error=TasksUnexpectedErrors,
    )
    bind_tasks_split_sort(
        app,
        handlers=TasksSplitSortHandlerFactories(notes=SplitSortNotesHandlers),
        authenticate={USER_IDENTITY: PagingUserHook},
        on_unexpected_error=TasksUnexpectedErrors,
    )
