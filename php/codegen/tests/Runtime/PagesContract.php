<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class with one list on a page style that counts its pages and links the last one. */
final class PagesContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'api' => ['id' => 'tasks', 'wire' => ['urls' => 'relative']],
        'operations' => [
            ['id' => 'listChannels', 'paging' => ['style' => 'pages', 'defaultLimit' => 2, 'maxLimit' => 100, 'overLimit' => 'clamp']],
        ],
        'pagings' => [
            'pages' => [
                'id' => 'pages',
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
                            ['name' => ['kind' => 'text', 'text' => 'lastPage'], 'value' => ['kind' => 'slot', 'slot' => 'totalPages', 'path' => []]],
                            ['name' => ['kind' => 'text', 'text' => 'first'], 'value' => ['kind' => 'slot', 'slot' => 'first', 'path' => []]],
                            ['name' => ['kind' => 'text', 'text' => 'last'], 'value' => ['kind' => 'slot', 'slot' => 'last', 'path' => []]],
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
    public const MOUNT = '';
}
