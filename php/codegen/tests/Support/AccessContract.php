<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class with one identity read from a bearer token or a session cookie, a scope read from an
 * integer path param, and a rule; `getTask` requires the identity, `listPublic` accepts an anonymous caller.
 */
final class AccessContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'schemes' => [
            'bearer' => ['kind' => 'bearer', 'name' => 'Authorization'],
            'session' => ['kind' => 'cookie', 'name' => 'sid'],
        ],
        'identities' => ['user' => []],
        'scopes' => ['channel' => ['idSchema' => ['kind' => 'scalar', 'type' => 'integer']]],
        'errors' => [
            'api.unauthenticated' => ['http' => ['status' => 401], 'default' => 'unauthenticated'],
            'api.csrf_invalid' => ['http' => ['status' => 403], 'default' => 'csrfInvalid'],
            'api.invalid' => ['http' => ['status' => 400], 'default' => 'schemaInvalid'],
            'tasks.not_owner' => ['http' => ['status' => 403]],
            'tasks.undeclared' => ['http' => ['status' => 403]],
        ],
        'rules' => ['tasks.owner' => ['errors' => ['tasks.not_owner']]],
        'operations' => [
            [
                'id' => 'getTask',
                'access' => ['kind' => 'required', 'identity' => 'user', 'schemes' => ['bearer', 'session']],
                'csrf' => ['header' => 'X-Csrf-Token'],
                'params' => ['path' => [['name' => 'channelId', 'type' => ['kind' => 'scalar', 'type' => 'integer']]]],
                'scopes' => [['scope' => 'channel', 'source' => ['in' => 'path', 'name' => 'channelId']]],
                'requires' => [['kind' => 'rule', 'rule' => 'tasks.owner']],
                'errors' => [['code' => 'api.unauthenticated'], ['code' => 'api.csrf_invalid'], ['code' => 'api.invalid'], ['code' => 'tasks.not_owner']],
            ],
            [
                'id' => 'listPublic',
                'access' => ['kind' => 'optional', 'identity' => 'user', 'schemes' => ['bearer'], 'onRefused' => 'anonymous'],
                'errors' => [['code' => 'api.unauthenticated'], ['code' => 'tasks.not_owner']],
            ],
        ],
    ];
    public const TYPES = [
        'identities' => ['user' => [
            'credentials' => AccessCredentials::class,
            'schemes' => ['bearer' => 'token', 'session' => 'cookie'],
            'principalMembers' => AccessPrincipal::class,
            'principalAccessors' => ['userId' => 'userId'],
        ]],
    ];
    public const ROUTES_CLASS = EmptyRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
