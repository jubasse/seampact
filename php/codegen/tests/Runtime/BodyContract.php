<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/**
 * A generated contract class with a JSON body bounded to 1,024 bytes, one path, query and header param, and the codes
 * of the body refusals; `uploadRaw` keeps the bytes for a signature, `uploadUncoded` has a limit and no 413 code.
 */
final class BodyContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => [
            'api.too_large' => ['http' => ['status' => 413], 'default' => 'payloadTooLarge'],
            'api.media' => ['http' => ['status' => 415], 'default' => 'unsupportedMediaType'],
            'api.invalid' => ['http' => ['status' => 400], 'default' => 'schemaInvalid'],
        ],
        'operations' => [
            [
                'id' => 'upload',
                'params' => [
                    'path' => [['name' => 'taskId', 'type' => ['kind' => 'scalar', 'type' => 'integer']]],
                    'query' => [
                        ['name' => 'page', 'type' => ['kind' => 'scalar', 'type' => 'integer']],
                        ['name' => 'tag', 'type' => ['kind' => 'array', 'items' => ['kind' => 'scalar', 'type' => 'string']]],
                    ],
                    'header' => [['name' => 'X-Attempt', 'type' => ['kind' => 'scalar', 'type' => 'integer']]],
                ],
                'input' => ['media' => 'application/json', 'bodyLimitBytes' => 1024],
                'errors' => [['code' => 'api.too_large'], ['code' => 'api.media'], ['code' => 'api.invalid']],
            ],
            [
                'id' => 'uploadRaw',
                'input' => ['media' => 'application/json', 'bodyLimitBytes' => 1024, 'rawBody' => true],
                'errors' => [['code' => 'api.too_large'], ['code' => 'api.media'], ['code' => 'api.invalid']],
            ],
            [
                'id' => 'uploadUncoded',
                'input' => ['media' => 'application/json', 'bodyLimitBytes' => 1024],
                'errors' => [['code' => 'api.media'], ['code' => 'api.invalid']],
            ],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
