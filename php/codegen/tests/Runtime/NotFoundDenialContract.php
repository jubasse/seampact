<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A generated contract class whose rule denies with its own code, on an operation with and without a not-found code. */
final class NotFoundDenialContract
{
    public const API = 'tasks';
    public const IR = [
        'errors' => [
            'api.not_found' => ['http' => ['status' => 404], 'default' => 'notFound'],
            'tasks.not_owner' => ['http' => ['status' => 403]],
        ],
        'rules' => ['tasks.owner' => ['errors' => ['tasks.not_owner']]],
        'operations' => [
            ['id' => 'getTask', 'errors' => [['code' => 'api.not_found'], ['code' => 'tasks.not_owner']]],
            ['id' => 'archiveTasks', 'errors' => [['code' => 'tasks.not_owner']]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
