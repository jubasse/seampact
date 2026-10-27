<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

/** A generated contract class with an operation that declares a not-found code and one that declares only forbidden. */
final class DeniedStatusContract
{
    public const API = 'tasks';
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
}
