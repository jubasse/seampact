"""The values the handlers answer without a script, and the scripted bodies read into the generated types."""

import uuid
from collections.abc import Mapping
from dataclasses import replace
from datetime import datetime
from typing import Final

from generated.tasks.schemas import Channel, Draft, Task, TaskState
from generated.tasks_absolute_urls.schemas import Note
from generated.tasks_service import schemas as service
from generated.tasks_service_writes import schemas as service_writes
from seampact_consumer_suite.scripted_answers import text_member

from seampact.hooks import ResolvedScope

GENERAL_CHANNEL_ID: Final = "10000000-0000-4000-8000-000000000001"
GENERAL_CHANNEL_NAME: Final = "General"
DRAFT_TEXT: Final = "Draft text"
NEW_TASK_ID: Final = uuid.UUID("20000000-0000-4000-8000-0000000000ff")
_DONE_TASK_ID: Final = uuid.UUID("20000000-0000-4000-8000-0000000000fe")
FIRST_NOTE_ID: Final = uuid.UUID("40000000-0000-4000-8000-000000000001")
_NOTE_TEXT: Final = "Read the slice notes"
FIRST_VERSION: Final = 1
_TASK_TITLE: Final = "Write the slice test"
_CREATED_AT: Final = datetime.fromisoformat("2026-10-18T09:00:00.000+00:00")


def channel(channel_id: str = GENERAL_CHANNEL_ID) -> Channel:
    return Channel(channel_id=uuid.UUID(channel_id), name=GENERAL_CHANNEL_NAME)


def channel_of(body: Mapping[str, object]) -> Channel:
    return Channel(channel_id=uuid.UUID(text_member(body, "channelId")), name=text_member(body, "name"))


def loaded_channel(scope: ResolvedScope, caller_id: str) -> Channel:
    """The channel the scope resolver loaded, as the handler reads it with its caller's id: the consumer proves the
    principal and the scopes reach the handler without a second lookup."""
    if caller_id == "":
        raise LookupError(f"the handler of scope '{scope.scope}' read no caller id from its principal")

    if not isinstance(scope.value, Channel):
        raise LookupError(f"the resolver of scope '{scope.scope}' loaded no channel for the handler")

    return scope.value


def draft(draft_id: uuid.UUID) -> Draft:
    return Draft(draft_id=draft_id, body=DRAFT_TEXT)


def task(task_id: uuid.UUID) -> Task:
    return Task(task_id=task_id, title=_TASK_TITLE, state=TaskState.OPEN, version=FIRST_VERSION, created_at=_CREATED_AT)


def listed_tasks(states: list[TaskState] | None) -> list[Task]:
    """The tasks `listTasks` answers: the new open task without a state filter, else the seeded tasks in the states
    the filter names, in the filter's order."""
    if states is None:
        return [task(NEW_TASK_ID)]

    seeded = [task(NEW_TASK_ID), replace(task(_DONE_TASK_ID), state=TaskState.DONE)]

    return [listed for state in states for listed in seeded if listed.state is state]


def task_of(body: Mapping[str, object]) -> Task:
    effort = body.get("effort")
    version = body.get("version")

    return Task(
        task_id=uuid.UUID(text_member(body, "taskId")),
        title=text_member(body, "title"),
        state=TaskState(text_member(body, "state")),
        effort=effort if isinstance(effort, int) else None,
        version=version if isinstance(version, int) else FIRST_VERSION,
        created_at=datetime.fromisoformat(text_member(body, "createdAt")),
    )


def with_next_version(current: Task, title: str, state: TaskState) -> Task:
    return replace(current, title=title, state=state, version=current.version + 1)


def service_task(task_id: uuid.UUID) -> service.Task:
    return _service_task_from(task(task_id))


def service_task_of(body: Mapping[str, object]) -> service.Task:
    return _service_task_from(task_of(body))


def _service_task_from(task_value: Task) -> service.Task:
    return service.Task(
        task_id=task_value.task_id,
        title=task_value.title,
        state=service.TaskState(task_value.state.value),
        effort=task_value.effort,
        version=task_value.version,
        created_at=task_value.created_at,
    )


def relayed_task(title: str, effort: int | None) -> service_writes.Task:
    """The task a service's relayed write creates, as the `tasksServiceWrites` api types it."""
    return service_writes.Task(
        task_id=NEW_TASK_ID,
        title=title,
        state=service_writes.TaskState.OPEN,
        effort=effort,
        version=FIRST_VERSION,
        created_at=_CREATED_AT,
    )


def note(note_id: uuid.UUID) -> Note:
    return Note(note_id=note_id, text=_NOTE_TEXT)
