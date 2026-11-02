"""The values the handlers answer without a script, and the scripted bodies read into the generated types."""

from collections.abc import Mapping
from typing import Final

from generated.tasks.schemas import Channel, Draft, Task, TaskState
from generated.tasks_service import schemas as service
from seampact_consumer_suite.scripted_answers import text_member

from seampact.hooks import ResolvedScope

GENERAL_CHANNEL_NAME: Final = "General"
GENERAL_CHANNEL_ID: Final = "10000000-0000-4000-8000-000000000001"
DRAFT_TEXT: Final = "Draft text"
TASK_TITLE: Final = "Write the slice test"
CREATED_AT: Final = "2026-10-18T09:00:00.000Z"
FIRST_VERSION: Final = 1
NEW_TASK_ID: Final = "20000000-0000-4000-8000-0000000000ff"


def task(task_id: str) -> Task:
    return Task.model_validate(
        {
            "task_id": task_id,
            "title": TASK_TITLE,
            "state": TaskState.OPEN,
            "version": FIRST_VERSION,
            "created_at": CREATED_AT,
        }
    )


def task_of(body: Mapping[str, object]) -> Task:
    effort = body.get("effort")
    version = body.get("version")
    values: dict[str, object] = {
        "task_id": text_member(body, "taskId"),
        "title": text_member(body, "title"),
        "state": TaskState(text_member(body, "state")),
        "version": version if isinstance(version, int) else FIRST_VERSION,
        "created_at": text_member(body, "createdAt"),
    }

    if isinstance(effort, int):
        values["effort"] = effort

    return Task.model_validate(values)


def service_task(task_id: str) -> service.Task:
    return _service_task_from(task(task_id))


def service_task_of(body: Mapping[str, object]) -> service.Task:
    return _service_task_from(task_of(body))


def _service_task_from(task_value: Task) -> service.Task:
    """The tasksService api's own task: its state is that api's enum, which the strict model requires."""
    values = task_value.model_dump(exclude_unset=True)
    values["state"] = service.TaskState(task_value.state.value)

    return service.Task.model_validate(values)


def with_next_version(current: Task, title: str, state: TaskState) -> Task:
    return current.model_copy(update={"title": title, "state": state, "version": current.version + 1})


def channel(channel_id: str) -> Channel:
    return Channel.model_validate({"channel_id": channel_id, "name": GENERAL_CHANNEL_NAME})


def channel_of(body: Mapping[str, object]) -> Channel:
    return Channel.model_validate({"channel_id": text_member(body, "channelId"), "name": text_member(body, "name")})


def loaded_channel(scope: ResolvedScope, caller_id: str) -> Channel:
    """The channel the scope resolver loaded, as the handler reads it with its caller's id: the consumer proves the
    principal and the scopes reach the handler without a second lookup."""
    if caller_id == "":
        raise LookupError(f"the handler of scope '{scope.scope}' read no caller id from its principal")

    if not isinstance(scope.value, Channel):
        raise LookupError(f"the resolver of scope '{scope.scope}' loaded no channel for the handler")

    return scope.value


def draft(draft_id: str) -> Draft:
    return Draft.model_validate({"draft_id": draft_id, "body": DRAFT_TEXT})
