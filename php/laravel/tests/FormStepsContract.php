<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class whose one operation answers its `schemaInvalid` role with the issues under an `issues` member. */
final class FormStepsContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => ['api.invalid' => ['http' => ['status' => 400], 'default' => 'schemaInvalid']],
        'operations' => [[
            'id' => 'createTask',
            'errors' => [[
                'code' => 'api.invalid',
                'roles' => [['role' => 'schemaInvalid', 'params' => ['kind' => 'object', 'members' => [
                    ['name' => ['kind' => 'text', 'text' => 'issues'], 'value' => ['kind' => 'slot', 'slot' => 'issues', 'path' => []]],
                ]]]],
            ]],
        ]],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = FormStepsRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
