<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;
use Seampact\Codegen\Tests\Support\EmptyRoutes;

/**
 * A generated contract class for the input rules check: `scheduleTask` has a body object and a header, `getTask` a
 * path parameter, `uploadTask` a text body, and `relayedTask` relays an operation of another api.
 */
final class InputRulesContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'operations' => [
            ['id' => 'scheduleTask', 'input' => ['schema' => ['kind' => 'ref', 'schema' => 'Window']]],
            ['id' => 'getTask'],
            ['id' => 'uploadTask', 'input' => ['schema' => ['kind' => 'scalar', 'type' => 'string']]],
            ['id' => 'relayedTask', 'relays' => ['kind' => 'operation', 'api' => 'upstream', 'id' => 'scheduleTask'], 'input' => ['schema' => ['kind' => 'ref', 'schema' => 'Window']]],
        ],
    ];
    public const TYPES = ['operations' => [
        'scheduleTask' => ['parts' => ['headers' => ['class' => 'H', 'members' => []]]],
        'getTask' => ['parts' => ['path' => ['class' => 'P', 'members' => []]]],
    ]];
    public const ROUTES_CLASS = EmptyRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
