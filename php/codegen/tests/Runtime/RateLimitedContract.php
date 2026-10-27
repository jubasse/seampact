<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/**
 * A generated contract class with no bucket rule, so no retry header: rate-limited codes whose delay param is
 * required, optional, or renamed by an authored role template.
 */
final class RateLimitedContract
{
    public const API = 'tasks';
    private const RETRY_AFTER_SLOT = ['kind' => 'slot', 'path' => [], 'slot' => 'retryAfterMs'];
    public const IR = [
        'formats' => ['problem' => ['error' => [
            'media' => 'application/problem+json',
            'body' => ['kind' => 'object', 'members' => [['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'path' => [], 'slot' => 'code']]]],
        ]]],
        'errors' => [
            'api.rate_limited' => ['http' => ['status' => 429], 'default' => 'rateLimited', 'params' => 'RateLimitedParams'],
            'tasks.patience' => ['http' => ['status' => 429], 'params' => 'PatienceParams'],
            'tasks.wait' => ['http' => ['status' => 429], 'params' => 'WaitParams'],
        ],
        'schemas' => [
            'RateLimitedParams' => ['kind' => 'object', 'properties' => [['name' => 'retryAfterMs', 'optional' => false]]],
            'PatienceParams' => ['kind' => 'object', 'properties' => [['name' => 'retryAfterMs', 'optional' => true]]],
            'WaitParams' => ['kind' => 'object', 'properties' => [['name' => 'waitMs', 'optional' => false]]],
        ],
        'operations' => [
            ['id' => 'limited', 'errors' => [['code' => 'api.rate_limited']]],
            ['id' => 'patient', 'errors' => [['code' => 'tasks.patience', 'roles' => [['role' => 'rateLimited', 'params' => [
                'kind' => 'object',
                'members' => [['name' => ['kind' => 'text', 'text' => 'retryAfterMs'], 'value' => self::RETRY_AFTER_SLOT]],
            ]]]]]],
            ['id' => 'waiting', 'errors' => [['code' => 'tasks.wait', 'roles' => [['role' => 'rateLimited', 'params' => [
                'kind' => 'object',
                'members' => [['name' => ['kind' => 'text', 'text' => 'waitMs'], 'value' => self::RETRY_AFTER_SLOT]],
            ]]]]]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
}
