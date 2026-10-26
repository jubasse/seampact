<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The headers parameters of operation 'createTask'.
 */
final readonly class CreateTaskHeaders
{
    public function __construct(
        public string $idempotencyKey,
    ) {
    }
}
