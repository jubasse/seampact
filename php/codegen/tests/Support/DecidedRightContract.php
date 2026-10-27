<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class with one right, `tasks.edit`, whose first declared denial code is `tasks.not_editor`. */
final class DecidedRightContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => [
            'api.forbidden' => ['http' => ['status' => 403], 'default' => 'forbidden'],
            'api.not_found' => ['http' => ['status' => 404], 'default' => 'notFound'],
            'tasks.not_editor' => ['http' => ['status' => 403]],
        ],
        'rights' => ['tasks.edit' => ['errors' => ['tasks.not_editor', 'api.forbidden']]],
        'operations' => [
            ['id' => 'editTask', 'errors' => [['code' => 'api.not_found'], ['code' => 'tasks.not_editor'], ['code' => 'api.forbidden']]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = DecidedRightRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
