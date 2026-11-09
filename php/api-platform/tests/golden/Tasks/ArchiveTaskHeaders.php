<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

/**
 * The headers parameters of operation 'archiveTask'.
 */
final readonly class ArchiveTaskHeaders
{
    public function __construct(
        public string $idempotencyKey,
    ) {
    }
}
