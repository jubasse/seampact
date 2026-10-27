<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Codegen\Runtime\WireValues;

/**
 * The path of each operation of api 'tasks', as the contract defines it.
 *
 * Each path value is encoded as one segment. The path is the contract's, which the boot check keeps equal to the
 * routed path, and stays a path when the api writes absolute URLs: the router builds a full URL from the route name.
 */
final class TasksUrls
{
  /**
   * The path of operation 'createTask', `/v1/channels/{channelId}/tasks`.
   */
  public static function createTask(string $channelId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks';
  }

  /**
   * The path of operation 'getChannel', `/v1/channels/{channelId}`.
   */
  public static function getChannel(string $channelId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId);
  }

  /**
   * The path of operation 'getDraft', `/v1/me/drafts/{draftId}`.
   */
  public static function getDraft(string $draftId): string
  {
    return '/v1/me/drafts/' . WireValues::pathSegment('draftId', $draftId);
  }

  /**
   * The path of operation 'getPreferences', `/v1/me/preferences`.
   */
  public static function getPreferences(): string
  {
    return '/v1/me/preferences';
  }

  /**
   * The path of operation 'getTask', `/v1/channels/{channelId}/tasks/{taskId}`.
   */
  public static function getTask(string $channelId, string $taskId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks/' . WireValues::pathSegment('taskId', $taskId);
  }

  /**
   * The path of operation 'getTasksBatch', `/v1/channels/{channelId}/tasks/batch`.
   */
  public static function getTasksBatch(string $channelId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks/batch';
  }

  /**
   * The path of operation 'health', `/v1/health`.
   */
  public static function health(): string
  {
    return '/v1/health';
  }

  /**
   * The path of operation 'listTasks', `/v1/channels/{channelId}/tasks`.
   */
  public static function listTasks(string $channelId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks';
  }

  /**
   * The path of operation 'payments', `/v1/hooks/payments`.
   */
  public static function payments(): string
  {
    return '/v1/hooks/payments';
  }

  /**
   * The path of operation 'purgeTask', `/v1/channels/{channelId}/tasks/{taskId}/purge`.
   */
  public static function purgeTask(string $channelId, string $taskId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks/' . WireValues::pathSegment('taskId', $taskId) . '/purge';
  }

  /**
   * The path of operation 'searchTasks', `/v1/channels/{channelId}/tasks/search`.
   */
  public static function searchTasks(string $channelId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks/search';
  }

  /**
   * The path of operation 'updateTask', `/v1/channels/{channelId}/tasks/{taskId}`.
   */
  public static function updateTask(string $channelId, string $taskId): string
  {
    return '/v1/channels/' . WireValues::pathSegment('channelId', $channelId) . '/tasks/' . WireValues::pathSegment('taskId', $taskId);
  }
}
