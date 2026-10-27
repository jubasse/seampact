<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;
use Seampact\Golden\TasksConsistent\AppEndpoints;
use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\DraftsEndpoints;
use Seampact\Golden\TasksConsistent\HooksEndpoints;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\KindMiddleware;
use Seampact\Golden\TasksConsistent\PreferencesEndpoints;
use Seampact\Golden\TasksConsistent\TasksEndpoints;

/**
 * The contract routes of api 'tasks', in registration order.
 */
final class TasksRoutes
{
    public const API = 'tasks';

    /** The run-time defaults the entry's options set, which `config('seampact.<api>.*')` overrides. */
    public const DEFAULTS = [
        'responses' => 'strict',
        'body_validation' => false,
        'framework_etag' => 'strip',
        'catch_all' => true,
        'middleware' => ['public' => [], 'optional' => [], 'identity' => [], 'signed' => []],
    ];

    /** @var list<array{operation: string, method: string, uri: string, placeholders: list<string>, name: string, access: string, signed?: true, cookieless?: true, action: array{class-string, string}}> */
    public const ROUTES = [
        [
            'operation' => 'health',
            'method' => 'GET',
            'uri' => '/v1/health',
            'placeholders' => [],
            'name' => 'seampact.tasks.health',
            'access' => 'public',
            'cookieless' => true,
            'action' => [AppEndpoints::class, 'health'],
        ],
        [
            'operation' => 'getPreferences',
            'method' => 'GET',
            'uri' => '/v1/me/preferences',
            'placeholders' => [],
            'name' => 'seampact.tasks.getPreferences',
            'access' => 'identity',
            'action' => [PreferencesEndpoints::class, 'getPreferences'],
        ],
        [
            'operation' => 'payments',
            'method' => 'POST',
            'uri' => '/v1/hooks/payments',
            'placeholders' => [],
            'name' => 'seampact.tasks.payments',
            'access' => 'identity',
            'signed' => true,
            'cookieless' => true,
            'action' => [HooksEndpoints::class, 'payments'],
        ],
        [
            'operation' => 'getChannel',
            'method' => 'GET',
            'uri' => '/v1/channels/{channelId}',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.getChannel',
            'access' => 'identity',
            'action' => [ChannelsEndpoints::class, 'getChannel'],
        ],
        [
            'operation' => 'getDraft',
            'method' => 'GET',
            'uri' => '/v1/me/drafts/{draftId}',
            'placeholders' => ['draftId'],
            'name' => 'seampact.tasks.getDraft',
            'access' => 'identity',
            'action' => [DraftsEndpoints::class, 'getDraft'],
        ],
        [
            'operation' => 'createTask',
            'method' => 'POST',
            'uri' => '/v1/channels/{channelId}/tasks',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.createTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'createTask'],
        ],
        [
            'operation' => 'listTasks',
            'method' => 'GET',
            'uri' => '/v1/channels/{channelId}/tasks',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.listTasks',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'listTasks'],
        ],
        [
            'operation' => 'getTasksBatch',
            'method' => 'POST',
            'uri' => '/v1/channels/{channelId}/tasks/batch',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.getTasksBatch',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'getTasksBatch'],
        ],
        [
            'operation' => 'searchTasks',
            'method' => 'POST',
            'uri' => '/v1/channels/{channelId}/tasks/search',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.searchTasks',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'searchTasks'],
        ],
        [
            'operation' => 'getTask',
            'method' => 'GET',
            'uri' => '/v1/channels/{channelId}/tasks/{taskId}',
            'placeholders' => ['channelId', 'taskId'],
            'name' => 'seampact.tasks.getTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'getTask'],
        ],
        [
            'operation' => 'updateTask',
            'method' => 'PATCH',
            'uri' => '/v1/channels/{channelId}/tasks/{taskId}',
            'placeholders' => ['channelId', 'taskId'],
            'name' => 'seampact.tasks.updateTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'updateTask'],
        ],
        [
            'operation' => 'purgeTask',
            'method' => 'POST',
            'uri' => '/v1/channels/{channelId}/tasks/{taskId}/purge',
            'placeholders' => ['channelId', 'taskId'],
            'name' => 'seampact.tasks.purgeTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'purgeTask'],
        ],
    ];

    /**
     * Registers every contract route, in order, inside the caller's route group, each behind the access middleware and the app's list for its access kind.
     */
    public static function register(): void
    {
        foreach (self::ROUTES as $route) {
            $registered = Route::match([$route['method']], $route['uri'], $route['action'])->name($route['name'])->where(array_fill_keys($route['placeholders'], '[^/]++'))->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of(self::API, ($route['signed'] ?? false) ? 'signed' : $route['access'])]);
            if ($route['cookieless'] ?? false) {
                $registered->withoutMiddleware(PreventRequestForgery::class);
            }
        }
    }
}
