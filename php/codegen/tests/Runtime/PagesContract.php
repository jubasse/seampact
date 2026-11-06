<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class with one list on a page style that counts its pages, links the last one and writes a flag
 * header, one on a Stripe-style pair of cursors, and one on a style whose header renders the items, which generation
 * refuses.
 */
final class PagesContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'api' => ['id' => 'tasks', 'wire' => ['urls' => 'relative']],
        'operations' => [
            ['id' => 'listChannels', 'paging' => ['style' => 'pages', 'defaultLimit' => 2, 'maxLimit' => 100, 'overLimit' => 'clamp']],
            ['id' => 'listCharges', 'paging' => ['style' => 'stripe', 'defaultLimit' => 10, 'maxLimit' => 100, 'overLimit' => 'reject']],
            ['id' => 'listItemsHeader', 'paging' => ['style' => 'itemsHeader', 'defaultLimit' => 2, 'maxLimit' => 100, 'overLimit' => 'clamp']],
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
                    'headers' => [
                        ['name' => 'X-Paged', 'value' => ['kind' => 'literal', 'value' => true]],
                        ['name' => 'X-Total-Pages', 'value' => ['kind' => 'slot', 'slot' => 'totalPages', 'path' => []]],
                    ],
                    'links' => [],
                ],
                'handlerResult' => ['total'],
            ],
            'itemsHeader' => [
                'id' => 'itemsHeader',
                'position' => 'page',
                'absent' => 'omit',
                'request' => [
                    ['role' => 'page', 'in' => 'query', 'name' => 'page', 'base' => 1],
                    ['role' => 'limit', 'in' => 'query', 'name' => 'per_page'],
                ],
                'response' => [
                    'body' => ['kind' => 'slot', 'slot' => 'items', 'path' => []],
                    'meta' => [],
                    'headers' => [['name' => 'X-Items', 'value' => ['kind' => 'slot', 'slot' => 'items', 'path' => []]]],
                    'links' => [],
                ],
                'handlerResult' => ['total'],
            ],
            'stripe' => [
                'id' => 'stripe',
                'position' => 'cursor',
                'absent' => 'omit',
                'request' => [
                    ['role' => 'after', 'in' => 'query', 'name' => 'starting_after'],
                    ['role' => 'before', 'in' => 'query', 'name' => 'ending_before'],
                    ['role' => 'limit', 'in' => 'query', 'name' => 'limit'],
                ],
                'response' => ['meta' => [], 'headers' => [], 'links' => []],
                'handlerResult' => ['more'],
            ],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
