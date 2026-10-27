<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A generated contract class with one operation whose throttle refusal carries a retry header and forbids storing. */
final class ThrottledContract
{
    public const API = 'tasks';
    public const IR = [
        'formats' => ['problem' => ['error' => [
            'media' => 'application/problem+json',
            'body' => ['kind' => 'object', 'members' => [['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'path' => [], 'slot' => 'code']]]],
        ]]],
        'errors' => [
            'api.rate_limited' => ['http' => ['status' => 429], 'noStore' => true, 'params' => null],
            'api.not_found' => ['http' => ['status' => 404]],
        ],
        'operations' => [[
            'id' => 'createTask',
            'errors' => [
                ['code' => 'api.rate_limited', 'retryHeader' => ['name' => 'Retry-After', 'param' => 'retryAfterMs', 'unit' => 's']],
                ['code' => 'api.not_found'],
            ],
        ]],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
