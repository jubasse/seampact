"""The pages of the reference contract's paged lists: the first task page links a second one, the second is the last."""

from generated.tasks.operations import ListChannelsPage, ListTasksInput, ListTasksPage
from generated.tasks.schemas import Channel, Task
from generated.tasks_absolute_urls.operations import ListNotesInput, ListNotesPage
from generated.tasks_absolute_urls.schemas import Note

_NEXT_CURSOR: str = "page-2"


def channel_page(channels: list[Channel]) -> ListChannelsPage:
    return ListChannelsPage(items=channels)


def sample_task_page(tasks: list[Task], task_input: ListTasksInput) -> ListTasksPage:
    return ListTasksPage(items=tasks, next_cursor=_NEXT_CURSOR if task_input.query.cursor is None else None)


def scripted_task_page(tasks: list[Task], body: dict[str, object]) -> ListTasksPage:
    next_cursor = body.get("nextCursor")

    return ListTasksPage(items=tasks, next_cursor=next_cursor if isinstance(next_cursor, str) else None)


def note_page(notes: list[Note], note_input: ListNotesInput) -> ListNotesPage:
    return ListNotesPage(items=notes, next_cursor=_NEXT_CURSOR if note_input.query.cursor is None else None)
