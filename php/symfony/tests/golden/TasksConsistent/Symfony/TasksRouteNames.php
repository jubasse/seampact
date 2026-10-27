<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The route name of each operation of api 'tasks', as the target registers it.
 */
final class TasksRouteNames
{
  /** The route of operation 'createTask', `POST /v1/channels/{channelId}/tasks`. */
  public const CREATE_TASK = 'seampact.tasks.createTask';

  /** The route of operation 'getChannel', `GET /v1/channels/{channelId}`. */
  public const GET_CHANNEL = 'seampact.tasks.getChannel';

  /** The route of operation 'getDraft', `GET /v1/me/drafts/{draftId}`. */
  public const GET_DRAFT = 'seampact.tasks.getDraft';

  /** The route of operation 'getPreferences', `GET /v1/me/preferences`. */
  public const GET_PREFERENCES = 'seampact.tasks.getPreferences';

  /** The route of operation 'getTask', `GET /v1/channels/{channelId}/tasks/{taskId}`. */
  public const GET_TASK = 'seampact.tasks.getTask';

  /** The route of operation 'getTasksBatch', `POST /v1/channels/{channelId}/tasks/batch`. */
  public const GET_TASKS_BATCH = 'seampact.tasks.getTasksBatch';

  /** The route of operation 'health', `GET /v1/health`. */
  public const HEALTH = 'seampact.tasks.health';

  /** The route of operation 'listTasks', `GET /v1/channels/{channelId}/tasks`. */
  public const LIST_TASKS = 'seampact.tasks.listTasks';

  /** The route of operation 'payments', `POST /v1/hooks/payments`. */
  public const PAYMENTS = 'seampact.tasks.payments';

  /** The route of operation 'purgeTask', `POST /v1/channels/{channelId}/tasks/{taskId}/purge`. */
  public const PURGE_TASK = 'seampact.tasks.purgeTask';

  /** The route of operation 'searchTasks', `POST /v1/channels/{channelId}/tasks/search`. */
  public const SEARCH_TASKS = 'seampact.tasks.searchTasks';

  /** The route of operation 'updateTask', `PATCH /v1/channels/{channelId}/tasks/{taskId}`. */
  public const UPDATE_TASK = 'seampact.tasks.updateTask';
}
