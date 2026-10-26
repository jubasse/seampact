<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\AppEndpoints;
use Seampact\Golden\Tasks\ChannelsEndpoints;
use Seampact\Golden\Tasks\DraftsEndpoints;
use Seampact\Golden\Tasks\TasksEndpoints;
use Symfony\Component\Config\Loader\Loader;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;

/**
 * The routes of the contract, imported once from the app's routing configuration:
 *
 *     resource: tasks
 *     type: seampact
 */
final class TasksRouteLoader extends Loader
{
    public const TYPE = 'seampact';
    public const RESOURCE = 'tasks';
    public const OPERATION_DEFAULT = '_seampact_operation';

    /** The run-time defaults the entry's options set; the bundle configuration overrides `responses`. */
    public const DEFAULTS = [
        'responses' => 'strict',
        'body_validation' => false,
        'framework_etag' => 'strip',
        'catch_all' => true,
    ];

    /**
     * Each operation's route, literal segments first per path depth.
     * @var list<array{operation: string, method: string, path: string, name: string, controller: array{class-string, string}}>
     */
    public const ROUTES = [
        [
            'operation' => 'health',
            'method' => 'GET',
            'path' => '/v1/health',
            'name' => 'seampact.tasks.health',
            'controller' => [AppEndpoints::class, 'health'],
        ],
        [
            'operation' => 'getChannel',
            'method' => 'GET',
            'path' => '/v1/channels/{p1}',
            'name' => 'seampact.tasks.getChannel',
            'controller' => [ChannelsEndpoints::class, 'getChannel'],
        ],
        [
            'operation' => 'getDraft',
            'method' => 'GET',
            'path' => '/v1/me/drafts/{p1}',
            'name' => 'seampact.tasks.getDraft',
            'controller' => [DraftsEndpoints::class, 'getDraft'],
        ],
        [
            'operation' => 'getTasksBatch',
            'method' => 'POST',
            'path' => '/v1/channels/{p1}/tasks/batch',
            'name' => 'seampact.tasks.getTasksBatch',
            'controller' => [TasksEndpoints::class, 'getTasksBatch'],
        ],
        [
            'operation' => 'getTask',
            'method' => 'GET',
            'path' => '/v1/channels/{p1}/tasks/{p2}',
            'name' => 'seampact.tasks.getTask',
            'controller' => [TasksEndpoints::class, 'getTask'],
        ],
    ];

    public function supports(mixed $resource, ?string $type = null): bool
    {
        return $type === self::TYPE && $resource === self::RESOURCE;
    }

    public function load(mixed $resource, ?string $type = null): RouteCollection
    {
        $routes = new RouteCollection();
        foreach (self::ROUTES as $route) {
            $defaults = ['_controller' => $route['controller'][0] . '::' . $route['controller'][1], self::OPERATION_DEFAULT => $route['operation']];
            $routes->add($route['name'], new Route($route['path'], $defaults, methods: [$route['method']]));
        }

        return $routes;
    }
}
