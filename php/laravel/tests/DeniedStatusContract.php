<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class with an operation that declares a not-found code and one that declares only forbidden. */
final class DeniedStatusContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => [
            'api.forbidden' => ['http' => ['status' => 403], 'default' => 'forbidden'],
            'api.not_found' => ['http' => ['status' => 404], 'default' => 'notFound'],
        ],
        'operations' => [
            ['id' => 'getTask', 'errors' => [['code' => 'api.not_found'], ['code' => 'api.forbidden']]],
            ['id' => 'archiveTasks', 'errors' => [['code' => 'api.forbidden']]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = DeniedStatusRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
