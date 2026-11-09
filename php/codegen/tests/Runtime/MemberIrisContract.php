<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class whose tasks list under a channel has a member route (`getTask`), whose notes list has
 * none, and whose page style writes each item's member URL as `@id`.
 */
final class MemberIrisContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'api' => ['id' => 'tasks', 'wire' => ['urls' => 'relative']],
        'operations' => [
            ['id' => 'listTasks', 'path' => '/v1/channels/{channelId}/tasks', 'resource' => ['type' => 'tasks', 'idProperty' => 'taskId'], 'paging' => ['style' => 'members', 'defaultLimit' => 2, 'maxLimit' => 100, 'overLimit' => 'clamp']],
            ['id' => 'getTask', 'path' => '/v1/channels/{channelId}/tasks/{taskId}', 'resource' => ['type' => 'tasks', 'idParam' => 'taskId', 'idProperty' => 'taskId']],
            ['id' => 'listNotes', 'path' => '/v1/channels/{channelId}/notes', 'resource' => ['type' => 'notes', 'idProperty' => 'noteId'], 'paging' => ['style' => 'members', 'defaultLimit' => 2, 'maxLimit' => 100, 'overLimit' => 'clamp']],
        ],
        'pagings' => [
            'members' => [
                'id' => 'members',
                'position' => 'page',
                'absent' => 'omit',
                'request' => [
                    ['role' => 'page', 'in' => 'query', 'name' => 'page', 'base' => 1],
                    ['role' => 'limit', 'in' => 'query', 'name' => 'per_page'],
                ],
                'response' => [
                    'body' => [
                        'kind' => 'object',
                        'members' => [
                            [
                                'name' => ['kind' => 'text', 'text' => 'member'],
                                'value' => [
                                    'kind' => 'each',
                                    'of' => 'items',
                                    'as' => [
                                        'kind' => 'object',
                                        'members' => [
                                            ['name' => ['kind' => 'text', 'text' => '@id'], 'value' => ['kind' => 'slot', 'slot' => 'itemSelf', 'path' => []]],
                                            ['name' => ['kind' => 'text', 'text' => 'id'], 'value' => ['kind' => 'slot', 'slot' => 'item', 'path' => ['id']]],
                                        ],
                                    ],
                                ],
                            ],
                        ],
                    ],
                    'meta' => [],
                    'headers' => [],
                    'links' => [],
                ],
                'handlerResult' => ['total'],
            ],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '/api';
}
