<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class whose `scheduleTask` takes a body (`start`, `end`, an optional `note`, `tags` of `label`
 * and `Label` wire names), an optional `dryRun` query parameter and an `X-Tenant` header, and answers `schemaInvalid`
 * with the issues; `relayedTask` relays another api's operation.
 */
final class InputRulesContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    private const TEXT = ['kind' => 'scalar', 'type' => 'string'];
    public const IR = [
        'errors' => ['api.invalid' => ['http' => ['status' => 400], 'default' => 'schemaInvalid']],
        'schemas' => [
            'Window' => ['properties' => [
                ['name' => 'start', 'type' => self::TEXT],
                ['name' => 'end', 'type' => self::TEXT],
                ['name' => 'note', 'type' => self::TEXT, 'optional' => true],
                ['name' => 'tags', 'type' => ['kind' => 'array', 'items' => ['kind' => 'ref', 'schema' => 'Tag']]],
            ]],
            'Tag' => ['properties' => [['name' => 'label-text', 'type' => self::TEXT]]],
        ],
        'operations' => [
            [
                'id' => 'scheduleTask',
                'params' => [
                    'query' => [['name' => 'dryRun', 'type' => ['kind' => 'scalar', 'type' => 'boolean']]],
                    'header' => [['name' => 'X-Tenant', 'type' => self::TEXT, 'required' => true]],
                ],
                'input' => ['schema' => ['kind' => 'ref', 'schema' => 'Window']],
                'errors' => [[
                    'code' => 'api.invalid',
                    'roles' => [['role' => 'schemaInvalid', 'params' => ['kind' => 'object', 'members' => [
                        ['name' => ['kind' => 'text', 'text' => 'issues'], 'value' => ['kind' => 'slot', 'slot' => 'issues', 'path' => []]],
                    ]]]],
                ]],
            ],
            ['id' => 'getTask', 'params' => ['path' => [['name' => 'id', 'type' => self::TEXT, 'required' => true]]]],
            ['id' => 'relayedTask', 'relays' => ['kind' => 'operation', 'api' => 'upstream', 'id' => 'scheduleTask'], 'input' => ['schema' => ['kind' => 'ref', 'schema' => 'Window']]],
        ],
    ];
    public const TYPES = [
        'inputRules' => TasksInputRules::class,
        'schemas' => [
            'Window' => ['class' => \stdClass::class, 'members' => ['start' => 'start', 'end' => 'end', 'note' => 'note', 'tags' => 'tags']],
            'Tag' => ['class' => \stdClass::class, 'members' => ['label-text' => 'labelText']],
        ],
        'operations' => [
            'scheduleTask' => ['input' => \stdClass::class, 'parts' => [
                'query' => ['class' => \stdClass::class, 'members' => ['dryRun' => 'dryRun']],
                'headers' => ['class' => \stdClass::class, 'members' => ['X-Tenant' => 'xTenant']],
            ]],
            'getTask' => ['parts' => ['path' => ['class' => \stdClass::class, 'members' => ['id' => 'id']]]],
        ],
    ];
    public const ROUTES_CLASS = InputRulesRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
