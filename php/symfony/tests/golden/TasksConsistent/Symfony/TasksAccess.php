<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

/**
 * The access of each contract route of api 'tasks', keyed by route name. The kind is the one
 * the request matcher service `seampact.tasks.matcher.<kind>` matches.
 */
final class TasksAccess
{
  /** @var list<string> */
  public const KINDS = ['public', 'optional', 'identity', 'signed'];

  /** @var array<string, array{operation: string, kind: string, identity: ?string, rights: list<string>, rules: list<string>, scopes: list<string>}> */
  public const ROUTES = [
    'seampact.tasks.createTask' => [
      'operation' => 'createTask',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => ['roles'],
      'rules' => ['throttle'],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.getChannel' => [
      'operation' => 'getChannel',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.getDraft' => [
      'operation' => 'getDraft',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => [],
    ],
    'seampact.tasks.getPreferences' => [
      'operation' => 'getPreferences',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => [],
    ],
    'seampact.tasks.getTask' => [
      'operation' => 'getTask',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.getTasksBatch' => [
      'operation' => 'getTasksBatch',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.health' => [
      'operation' => 'health',
      'kind' => 'public',
      'identity' => null,
      'rights' => [],
      'rules' => [],
      'scopes' => [],
    ],
    'seampact.tasks.listTasks' => [
      'operation' => 'listTasks',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => [],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.payments' => [
      'operation' => 'payments',
      'kind' => 'signed',
      'identity' => 'stripe',
      'rights' => [],
      'rules' => [],
      'scopes' => [],
    ],
    'seampact.tasks.purgeTask' => [
      'operation' => 'purgeTask',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => [],
      'rules' => ['recentAuth'],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.searchTasks' => [
      'operation' => 'searchTasks',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => ['tasks.read'],
      'rules' => [],
      'scopes' => ['channel'],
    ],
    'seampact.tasks.updateTask' => [
      'operation' => 'updateTask',
      'kind' => 'identity',
      'identity' => 'user',
      'rights' => ['tasks.update'],
      'rules' => [],
      'scopes' => ['channel'],
    ],
  ];
}
