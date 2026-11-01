<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Golden\TasksConsistent\Laravel\TasksContract;

/**
 * The golden tasks contract with a frameworkRoutes allow-list that names `/v1/files/*` (one segment) and
 * `/v1/docs/**` (any number), for the boot check's reading of a catch-all app route.
 */
final class CatchAllAllowListContract
{
    public const API = TasksContract::API;
    public const GENERATED_BY = TasksContract::GENERATED_BY;
    public const ROUTES_CLASS = TasksContract::ROUTES_CLASS;
    public const IR = TasksContract::IR;
    public const TYPES = TasksContract::TYPES;
    public const FRAMEWORK_ROUTES = [['method' => null, 'path' => '/v1/files/*'], ['method' => null, 'path' => '/v1/docs/**']];
    public const FRAMEWORK_ROUTE_SCOPE = TasksContract::FRAMEWORK_ROUTE_SCOPE;
    public const MOUNT = TasksContract::MOUNT;
}
