<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Illuminate\Support\Facades\Route;
use Seampact\Golden\TasksConsistent\AppEndpoints;
use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\DraftsEndpoints;
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
    ];

    /** @var list<array{operation: string, method: string, uri: string, name: string, access: string, action: array{class-string, string}}> */
    public const ROUTES = [
        [
            'operation' => 'health',
            'method' => 'GET',
            'uri' => '/v1/health',
            'name' => 'seampact.tasks.health',
            'access' => 'public',
            'action' => [AppEndpoints::class, 'health'],
        ],
        [
            'operation' => 'getChannel',
            'method' => 'GET',
            'uri' => '/v1/channels/{p1}',
            'name' => 'seampact.tasks.getChannel',
            'access' => 'identity',
            'action' => [ChannelsEndpoints::class, 'getChannel'],
        ],
        [
            'operation' => 'getDraft',
            'method' => 'GET',
            'uri' => '/v1/me/drafts/{p1}',
            'name' => 'seampact.tasks.getDraft',
            'access' => 'identity',
            'action' => [DraftsEndpoints::class, 'getDraft'],
        ],
        [
            'operation' => 'createTask',
            'method' => 'POST',
            'uri' => '/v1/channels/{p1}/tasks',
            'name' => 'seampact.tasks.createTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'createTask'],
        ],
        [
            'operation' => 'listTasks',
            'method' => 'GET',
            'uri' => '/v1/channels/{p1}/tasks',
            'name' => 'seampact.tasks.listTasks',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'listTasks'],
        ],
        [
            'operation' => 'getTasksBatch',
            'method' => 'POST',
            'uri' => '/v1/channels/{p1}/tasks/batch',
            'name' => 'seampact.tasks.getTasksBatch',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'getTasksBatch'],
        ],
        [
            'operation' => 'getTask',
            'method' => 'GET',
            'uri' => '/v1/channels/{p1}/tasks/{p2}',
            'name' => 'seampact.tasks.getTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'getTask'],
        ],
        [
            'operation' => 'updateTask',
            'method' => 'PATCH',
            'uri' => '/v1/channels/{p1}/tasks/{p2}',
            'name' => 'seampact.tasks.updateTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'updateTask'],
        ],
        [
            'operation' => 'purgeTask',
            'method' => 'POST',
            'uri' => '/v1/channels/{p1}/tasks/{p2}/purge',
            'name' => 'seampact.tasks.purgeTask',
            'access' => 'identity',
            'action' => [TasksEndpoints::class, 'purgeTask'],
        ],
    ];

    /**
     * Registers every contract route, in order, inside the caller's route group, each behind the access middleware.
     */
    public static function register(): void
    {
        foreach (self::ROUTES as $route) {
            Route::match([$route['method']], $route['uri'], $route['action'])->name($route['name'])->middleware(TasksAccessMiddleware::class);
        }
    }
}
