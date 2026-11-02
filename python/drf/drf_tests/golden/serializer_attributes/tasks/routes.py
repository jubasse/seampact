"""The route names and contract paths of api 'tasks'."""

import typing as _typing
import uuid as _uuid

import seampact.codegen.runtime.wire_values as _wire_values


class TasksRouteNames:
    """The route name of each operation, as the target registers it."""

    CREATE_TASK: _typing.Final = "seampact.tasks.createTask"


class TasksUrls:
    """The path of each operation, each value encoded as one segment."""

    @staticmethod
    def create_task(channel_id: _uuid.UUID) -> str:
        """The path of operation 'createTask', `/v1/channels/{channelId}/tasks`."""
        return _wire_values.contract_path("/v1/channels/{channelId}/tasks", {"channelId": channel_id})
