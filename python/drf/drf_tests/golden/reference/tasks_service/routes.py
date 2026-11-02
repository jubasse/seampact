"""The route names and contract paths of api 'tasksService'."""

import typing as _typing
import uuid as _uuid

import seampact.codegen.runtime.wire_values as _wire_values


class TasksServiceRouteNames:
    """The route name of each operation, as the target registers it."""

    GET_TASK: _typing.Final = "seampact.tasksService.getTask"


class TasksServiceUrls:
    """The path of each operation, each value encoded as one segment."""

    @staticmethod
    def get_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'getTask', `/internal/v1/channels/{channelId}/tasks/{taskId}`."""
        return _wire_values.contract_path(
            "/internal/v1/channels/{channelId}/tasks/{taskId}",
            {"channelId": channel_id, "taskId": task_id},
        )
