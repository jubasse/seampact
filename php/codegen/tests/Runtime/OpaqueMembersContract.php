<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

/** A generated contract class with one schema whose members are opaque values. */
final class OpaqueMembersContract
{
    public const API = 'tasks';
    public const IR = [
        'schemas' => ['event' => ['properties' => [
            ['name' => 'payload', 'type' => ['kind' => 'opaque', 'reason' => 'any webhook payload', 'nullable' => true], 'nullable' => true],
            ['name' => 'meta', 'type' => ['kind' => 'opaque', 'reason' => 'any webhook payload']],
        ]]],
        'operations' => [],
    ];
    public const TYPES = ['schemas' => ['event' => [
        'class' => OpaqueMembersEvent::class,
        'members' => ['payload' => 'payload', 'meta' => 'meta'],
    ]]];
    public const ROUTES_CLASS = SelectionRoutes::class;
    public const FRAMEWORK_ROUTES = [];
}
