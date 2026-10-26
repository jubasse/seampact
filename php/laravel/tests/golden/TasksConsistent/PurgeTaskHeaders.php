<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

/**
 * The headers parameters of operation 'purgeTask'.
 */
final readonly class PurgeTaskHeaders
{
    public function __construct(
        public string $idempotencyKey,
    ) {
    }
}
