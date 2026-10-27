<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\WireValues;

/**
 * The path of each operation of api 'tasks', as the contract defines it.
 *
 * Each path value is encoded as one segment. The path carries no prefix of the route group or import serving it,
 * and stays a path when the api writes absolute URLs: the router builds a full URL from the route name.
 */
final class TasksUrls
{
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
}
