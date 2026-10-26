<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\AppEndpoints;
use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\DraftsEndpoints;
use Seampact\Golden\TasksConsistent\HooksEndpoints;
use Seampact\Golden\TasksConsistent\PreferencesEndpoints;
use Seampact\Golden\TasksConsistent\TasksEndpoints;
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
      'operation' => 'getPreferences',
      'method' => 'GET',
      'path' => '/v1/me/preferences',
      'name' => 'seampact.tasks.getPreferences',
      'controller' => [PreferencesEndpoints::class, 'getPreferences'],
    ],
    [
      'operation' => 'payments',
      'method' => 'POST',
      'path' => '/v1/hooks/payments',
      'name' => 'seampact.tasks.payments',
      'controller' => [HooksEndpoints::class, 'payments'],
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
      'operation' => 'createTask',
      'method' => 'POST',
      'path' => '/v1/channels/{p1}/tasks',
      'name' => 'seampact.tasks.createTask',
      'controller' => [TasksEndpoints::class, 'createTask'],
    ],
    [
      'operation' => 'listTasks',
      'method' => 'GET',
      'path' => '/v1/channels/{p1}/tasks',
      'name' => 'seampact.tasks.listTasks',
      'controller' => [TasksEndpoints::class, 'listTasks'],
    ],
    [
      'operation' => 'getTasksBatch',
      'method' => 'POST',
      'path' => '/v1/channels/{p1}/tasks/batch',
      'name' => 'seampact.tasks.getTasksBatch',
      'controller' => [TasksEndpoints::class, 'getTasksBatch'],
    ],
    [
      'operation' => 'searchTasks',
      'method' => 'POST',
      'path' => '/v1/channels/{p1}/tasks/search',
      'name' => 'seampact.tasks.searchTasks',
      'controller' => [TasksEndpoints::class, 'searchTasks'],
    ],
    [
      'operation' => 'getTask',
      'method' => 'GET',
      'path' => '/v1/channels/{p1}/tasks/{p2}',
      'name' => 'seampact.tasks.getTask',
      'controller' => [TasksEndpoints::class, 'getTask'],
    ],
    [
      'operation' => 'updateTask',
      'method' => 'PATCH',
      'path' => '/v1/channels/{p1}/tasks/{p2}',
      'name' => 'seampact.tasks.updateTask',
      'controller' => [TasksEndpoints::class, 'updateTask'],
    ],
    [
      'operation' => 'purgeTask',
      'method' => 'POST',
      'path' => '/v1/channels/{p1}/tasks/{p2}/purge',
      'name' => 'seampact.tasks.purgeTask',
      'controller' => [TasksEndpoints::class, 'purgeTask'],
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
