"""The route names and contract paths of api 'tasks'."""

import typing as _typing
import uuid as _uuid

import seampact.codegen.runtime.wire_values as _wire_values


class TasksRouteNames:
    """The route name of each operation, under the NinjaAPI's urls_namespace: reverse "<namespace>:<name>"."""

    ARCHIVE_TASK: _typing.Final = "seampact.tasks.archiveTask"
    ASSIGN_TASK: _typing.Final = "seampact.tasks.assignTask"
    CREATE_TASK: _typing.Final = "seampact.tasks.createTask"
    DELETE_DRAFT: _typing.Final = "seampact.tasks.deleteDraft"
    GET_CHANNEL: _typing.Final = "seampact.tasks.getChannel"
    GET_DRAFT: _typing.Final = "seampact.tasks.deleteDraft"
    GET_PREFERENCES: _typing.Final = "seampact.tasks.getPreferences"
    GET_TASK: _typing.Final = "seampact.tasks.getTask"
    GET_TASKS_BATCH: _typing.Final = "seampact.tasks.getTasksBatch"
    HEALTH: _typing.Final = "seampact.tasks.health"
    LIST_CHANNELS: _typing.Final = "seampact.tasks.listChannels"
    LIST_TASKS: _typing.Final = "seampact.tasks.createTask"
    PAYMENTS: _typing.Final = "seampact.tasks.payments"
    PURGE_TASK: _typing.Final = "seampact.tasks.purgeTask"
    SEARCH_TASKS: _typing.Final = "seampact.tasks.searchTasks"
    UPDATE_PREFERENCES: _typing.Final = "seampact.tasks.getPreferences"
    UPDATE_TASK: _typing.Final = "seampact.tasks.getTask"


class TasksUrls:
    """The path of each operation, each value encoded as one segment."""

    @staticmethod
    def archive_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'archiveTask', `/v1/channels/{channelId}/tasks/{taskId}/archive`."""
        return _wire_values.contract_path(
            "/v1/channels/{channelId}/tasks/{taskId}/archive",
            {"channelId": channel_id, "taskId": task_id},
        )

    @staticmethod
    def assign_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'assignTask', `/v1/channels/{channelId}/tasks/{taskId}/assign`."""
        return _wire_values.contract_path(
            "/v1/channels/{channelId}/tasks/{taskId}/assign",
            {"channelId": channel_id, "taskId": task_id},
        )

    @staticmethod
    def create_task(channel_id: _uuid.UUID) -> str:
        """The path of operation 'createTask', `/v1/channels/{channelId}/tasks`."""
        return _wire_values.contract_path("/v1/channels/{channelId}/tasks", {"channelId": channel_id})

    @staticmethod
    def delete_draft(draft_id: _uuid.UUID) -> str:
        """The path of operation 'deleteDraft', `/v1/me/drafts/{draftId}`."""
        return _wire_values.contract_path("/v1/me/drafts/{draftId}", {"draftId": draft_id})

    @staticmethod
    def get_channel(channel_id: _uuid.UUID) -> str:
        """The path of operation 'getChannel', `/v1/channels/{channelId}`."""
        return _wire_values.contract_path("/v1/channels/{channelId}", {"channelId": channel_id})

    @staticmethod
    def get_draft(draft_id: _uuid.UUID) -> str:
        """The path of operation 'getDraft', `/v1/me/drafts/{draftId}`."""
        return _wire_values.contract_path("/v1/me/drafts/{draftId}", {"draftId": draft_id})

    @staticmethod
    def get_preferences() -> str:
        """The path of operation 'getPreferences', `/v1/me/preferences`."""
        return "/v1/me/preferences"

    @staticmethod
    def get_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'getTask', `/v1/channels/{channelId}/tasks/{taskId}`."""
        return _wire_values.contract_path(
            "/v1/channels/{channelId}/tasks/{taskId}",
            {"channelId": channel_id, "taskId": task_id},
        )

    @staticmethod
    def get_tasks_batch(channel_id: _uuid.UUID) -> str:
        """The path of operation 'getTasksBatch', `/v1/channels/{channelId}/tasks/batch`."""
        return _wire_values.contract_path("/v1/channels/{channelId}/tasks/batch", {"channelId": channel_id})

    @staticmethod
    def health() -> str:
        """The path of operation 'health', `/v1/health`."""
        return "/v1/health"

    @staticmethod
    def list_channels() -> str:
        """The path of operation 'listChannels', `/v1/channels`."""
        return "/v1/channels"

    @staticmethod
    def list_tasks(channel_id: _uuid.UUID) -> str:
        """The path of operation 'listTasks', `/v1/channels/{channelId}/tasks`."""
        return _wire_values.contract_path("/v1/channels/{channelId}/tasks", {"channelId": channel_id})

    @staticmethod
    def payments() -> str:
        """The path of operation 'payments', `/v1/hooks/payments`."""
        return "/v1/hooks/payments"

    @staticmethod
    def purge_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'purgeTask', `/v1/channels/{channelId}/tasks/{taskId}/purge`."""
        return _wire_values.contract_path(
            "/v1/channels/{channelId}/tasks/{taskId}/purge",
            {"channelId": channel_id, "taskId": task_id},
        )

    @staticmethod
    def search_tasks(channel_id: _uuid.UUID) -> str:
        """The path of operation 'searchTasks', `/v1/channels/{channelId}/tasks/search`."""
        return _wire_values.contract_path("/v1/channels/{channelId}/tasks/search", {"channelId": channel_id})

    @staticmethod
    def update_preferences() -> str:
        """The path of operation 'updatePreferences', `/v1/me/preferences`."""
        return "/v1/me/preferences"

    @staticmethod
    def update_task(channel_id: _uuid.UUID, task_id: _uuid.UUID) -> str:
        """The path of operation 'updateTask', `/v1/channels/{channelId}/tasks/{taskId}`."""
        return _wire_values.contract_path(
            "/v1/channels/{channelId}/tasks/{taskId}",
            {"channelId": channel_id, "taskId": task_id},
        )
