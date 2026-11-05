<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class with a right `roles` that declares its params schema, and a right `tasks.read` that declares none. */
final class TypedParamsContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'rights' => [
            'roles' => ['params' => 'RolesParams', 'errors' => ['api.forbidden']],
            'tasks.read' => ['errors' => ['api.forbidden']],
        ],
        'schemas' => ['RolesParams' => ['properties' => [
            ['name' => 'allowed', 'type' => ['kind' => 'array', 'items' => ['kind' => 'scalar', 'type' => 'string']]],
        ]]],
        'operations' => [],
    ];
    public const TYPES = ['schemas' => ['RolesParams' => [
        'class' => TypedParamsRoles::class,
        'members' => ['allowed' => 'allowed'],
    ]]];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
