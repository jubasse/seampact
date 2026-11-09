<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Golden\TasksConsistent\Symfony\TasksContract;

/** The golden tasks contract of a flavour that generates no input rules interface: only its TYPES lack it. */
final class NoInputRulesInterfaceContract
{
    public const API = TasksContract::API;
    public const GENERATED_BY = TasksContract::GENERATED_BY;
    public const ROUTES_CLASS = TasksContract::ROUTES_CLASS;
    public const IR = TasksContract::IR;
    public const TYPES = [];
    public const FRAMEWORK_ROUTES = TasksContract::FRAMEWORK_ROUTES;
    public const FRAMEWORK_ROUTE_SCOPE = TasksContract::FRAMEWORK_ROUTE_SCOPE;
    public const MOUNT = TasksContract::MOUNT;
}
