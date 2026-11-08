<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class whose `updateTask` restricts three input members: `/effort` refused, `/note` stripped, `/a~1b` (member `a/b`) refused. */
final class InputFieldRightsContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => ['tasks.not_allowed' => ['http' => ['status' => 403]]],
        'rights' => ['tasks.edit_restricted' => ['errors' => ['tasks.not_allowed']]],
        'operations' => [[
            'id' => 'updateTask',
            'errors' => [[
                'code' => 'tasks.not_allowed',
                'roles' => [['role' => 'forbidden', 'params' => ['kind' => 'object', 'members' => [
                    ['name' => ['kind' => 'text', 'text' => 'field'], 'value' => ['kind' => 'slot', 'slot' => 'pointer', 'path' => []]],
                ]]]],
            ]],
            'fieldRights' => [
                ['direction' => 'input', 'schema' => 'Task', 'pointer' => '/effort', 'right' => 'tasks.edit_restricted'],
                ['direction' => 'input', 'schema' => 'Task', 'pointer' => '/note', 'right' => 'tasks.edit_restricted', 'inputPolicy' => 'strip'],
                ['direction' => 'input', 'schema' => 'Task', 'pointer' => '/a~1b', 'right' => 'tasks.edit_restricted'],
                ['direction' => 'output', 'schema' => 'Task', 'pointer' => '/secret', 'right' => 'tasks.edit_restricted'],
            ],
        ]],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
