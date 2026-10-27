<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel;

use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\Route;
use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\ChannelsEndpoints;
use Seampact\Golden\Tasks\DraftsEndpoints;
use Seampact\Golden\Tasks\Laravel\Runtime\KindMiddleware;
use Seampact\Golden\Tasks\TasksEndpoints;

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
            'operation' => 'getTasksBatch',
            'method' => 'POST',
            'uri' => '/v1/channels/{channelId}/tasks/batch',
            'placeholders' => ['channelId'],
            'name' => 'seampact.tasks.getTasksBatch',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'getTasksBatch'],
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
    ];

    /**
     * Registers every contract route, in order, inside the caller's route group, each behind the access middleware and the app's list for its access kind.
     */
    public static function register(): void
    {
        foreach (self::ROUTES as $route) {
            $registered = Route::match([$route['method']], $route['uri'], $route['action'])->name($route['name'])->where(array_fill_keys($route['placeholders'], '[^/]++'))->middleware([TasksAccessMiddleware::class, ...KindMiddleware::of(self::API, $route['access'])]);
            if ($route['cookieless'] ?? false) {
                $registered->withoutMiddleware(PreventRequestForgery::class);
            }
        }
    }
}
