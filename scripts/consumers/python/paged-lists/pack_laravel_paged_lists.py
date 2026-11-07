"""The pages of the pack-laravel contract's paged lists: the handler answers the items and the total its paging style
asks for, and the boundary writes Laravel's page links and meta."""

from generated.tasks.operations import ListChannelsPage, ListTasksInput, ListTasksPage
from generated.tasks.schemas import Channel, Task
from generated.tasks_absolute_urls.operations import ListNotesInput, ListNotesPage
from generated.tasks_absolute_urls.schemas import Note

_SAMPLE_TOTAL: int = 3


def channel_page(channels: list[Channel]) -> ListChannelsPage:
    return ListChannelsPage(items=channels, total=len(channels))


def sample_task_page(tasks: list[Task], task_input: ListTasksInput) -> ListTasksPage:
    # Whatever page the query asks for, the sample list holds three tasks.
    return ListTasksPage(items=tasks, total=_SAMPLE_TOTAL)


def scripted_task_page(tasks: list[Task], body: dict[str, object]) -> ListTasksPage:
    total = body.get("total")

    return ListTasksPage(items=tasks, total=total if isinstance(total, int) else len(tasks))


def note_page(notes: list[Note], note_input: ListNotesInput) -> ListNotesPage:
    return ListNotesPage(items=notes, total=len(notes))
