<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use Seampact\Codegen\Runtime\RuntimeVersion;

/** A generated contract class with one write the boundary makes idempotent; its 201 declares a `Location` header. */
final class IdempotentContract
{
    public const API = 'tasks';
    public const GENERATED_BY = RuntimeVersion::VERSION;
    public const IR = [
        'errors' => [
            'api.in_progress' => ['http' => ['status' => 409], 'default' => 'idempotencyInProgress'],
            'api.key_reused' => ['http' => ['status' => 422], 'default' => 'idempotencyKeyReused'],
        ],
        'operations' => [[
            'id' => 'createTask',
            'method' => 'POST',
            'path' => '/v1/tasks',
            'idempotency' => ['kind' => 'derived', 'enforce' => 'boundary', 'header' => 'idempotency-key', 'replayHeader' => 'Idempotent-Replayed', 'lifetimeMs' => 60000],
            'params' => ['header' => [
                ['name' => 'idempotency-key', 'derivedFrom' => ['derivation' => 'idempotency.key']],
                ['name' => 'x-tenant'],
            ]],
            'responses' => [['status' => 201, 'headers' => [['name' => 'Location']]]],
            'errors' => [['code' => 'api.in_progress'], ['code' => 'api.key_reused']],
        ]],
    ];
    public const TYPES = [];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
    public const FRAMEWORK_ROUTE_SCOPE = 'contract';
    public const MOUNT = '';
}
