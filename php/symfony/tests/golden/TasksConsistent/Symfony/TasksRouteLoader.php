<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\AppEndpoints;
use Seampact\Golden\TasksConsistent\ChannelsEndpoints;
use Seampact\Golden\TasksConsistent\DraftsEndpoints;
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

  public function supports(mixed $resource, ?string $type = null): bool
  {
    return $type === self::TYPE && $resource === self::RESOURCE;
  }

  public function load(mixed $resource, ?string $type = null): RouteCollection
  {
    $routes = new RouteCollection();
    $routes->add('seampact.tasks.health', new Route('/v1/health', ['_controller' => AppEndpoints::class . '::health', self::OPERATION_DEFAULT => 'health'], methods: ['GET']));
    $routes->add('seampact.tasks.getChannel', new Route('/v1/channels/{p1}', ['_controller' => ChannelsEndpoints::class . '::getChannel', self::OPERATION_DEFAULT => 'getChannel'], methods: ['GET']));
    $routes->add('seampact.tasks.getDraft', new Route('/v1/me/drafts/{p1}', ['_controller' => DraftsEndpoints::class . '::getDraft', self::OPERATION_DEFAULT => 'getDraft'], methods: ['GET']));
    $routes->add('seampact.tasks.getTasksBatch', new Route('/v1/channels/{p1}/tasks/batch', ['_controller' => TasksEndpoints::class . '::getTasksBatch', self::OPERATION_DEFAULT => 'getTasksBatch'], methods: ['POST']));
    $routes->add('seampact.tasks.getTask', new Route('/v1/channels/{p1}/tasks/{p2}', ['_controller' => TasksEndpoints::class . '::getTask', self::OPERATION_DEFAULT => 'getTask'], methods: ['GET']));

    return $routes;
  }
}
