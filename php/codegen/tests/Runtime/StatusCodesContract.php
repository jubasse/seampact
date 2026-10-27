<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/**
 * A generated contract class whose operations declare codes by role and by status, with and without required params,
 * and a rate-limited code whose one required param is the delay its retry header writes.
 */
final class StatusCodesContract
{
    public const API = 'tasks';
    private const RETRY_HEADER = ['name' => 'Retry-After', 'param' => 'retryAfterMs', 'unit' => 's'];
    public const IR = [
        'formats' => ['problem' => ['error' => [
            'media' => 'application/problem+json',
            'body' => ['kind' => 'object', 'members' => [['name' => ['kind' => 'text', 'text' => 'code'], 'value' => ['kind' => 'slot', 'path' => [], 'slot' => 'code']]]],
        ]]],
        'errors' => [
            'api.not_found' => ['http' => ['status' => 404], 'default' => 'notFound'],
            'tasks.missing' => ['http' => ['status' => 404]],
            'tasks.teapot' => ['http' => ['status' => 418]],
            'tasks.other_teapot' => ['http' => ['status' => 418]],
            'tasks.conflict' => ['http' => ['status' => 409], 'params' => 'ConflictParams'],
            'tasks.hint' => ['http' => ['status' => 422], 'params' => 'HintParams'],
            'tasks.stale' => ['http' => ['status' => 409], 'params' => 'StaleParams'],
            'api.rate_limited' => ['http' => ['status' => 429], 'default' => 'rateLimited', 'params' => 'RateLimitedParams'],
            'tasks.quota' => ['http' => ['status' => 429], 'params' => 'QuotaParams'],
        ],
        'schemas' => [
            'ConflictParams' => ['kind' => 'object', 'properties' => [['name' => 'version', 'optional' => false]]],
            'HintParams' => ['kind' => 'object', 'properties' => [['name' => 'hint', 'optional' => true]]],
            'StaleParams' => ['kind' => 'object', 'properties' => [['name' => 'version', 'optional' => false, 'default' => 1]]],
            'RateLimitedParams' => ['kind' => 'object', 'properties' => [['name' => 'retryAfterMs', 'optional' => false]]],
            'QuotaParams' => ['kind' => 'object', 'properties' => [['name' => 'retryAfterMs', 'optional' => false], ['name' => 'quota', 'optional' => false]]],
        ],
        'operations' => [
            ['id' => 'byRole', 'errors' => [['code' => 'api.not_found'], ['code' => 'tasks.missing']]],
            ['id' => 'byStatus', 'errors' => [['code' => 'tasks.missing'], ['code' => 'tasks.teapot'], ['code' => 'tasks.hint'], ['code' => 'tasks.stale']]],
            ['id' => 'ambiguous', 'errors' => [['code' => 'tasks.teapot'], ['code' => 'tasks.other_teapot'], ['code' => 'tasks.conflict']]],
            ['id' => 'throttled', 'errors' => [['code' => 'api.rate_limited', 'retryHeader' => self::RETRY_HEADER]]],
            ['id' => 'throttledWithoutRule', 'errors' => [['code' => 'api.rate_limited']]],
            ['id' => 'quota', 'errors' => [['code' => 'tasks.quota', 'retryHeader' => self::RETRY_HEADER]]],
        ],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
}
