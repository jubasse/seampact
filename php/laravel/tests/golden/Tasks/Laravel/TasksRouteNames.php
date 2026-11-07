<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

/**
 * The route name of each operation of api 'tasks', as the target registers it.
 */
final class TasksRouteNames
{
    /** The route of operation 'getChannel', `GET /v1/channels/{channelId}`. */
    public const GET_CHANNEL = 'seampact.tasks.getChannel';

    /** The route of operation 'getDraft', `GET /v1/me/drafts/{draftId}`. */
    public const GET_DRAFT = 'seampact.tasks.getDraft';

    /** The route of operation 'getTask', `GET /v1/channels/{channelId}/tasks/{taskId}`. */
    public const GET_TASK = 'seampact.tasks.getTask';

    /** The route of operation 'getTasksBatch', `POST /v1/channels/{channelId}/tasks/batch`. */
    public const GET_TASKS_BATCH = 'seampact.tasks.getTasksBatch';

    /** The route of operation 'health', `GET /v1/health`. */
    public const HEALTH = 'seampact.tasks.health';
}
