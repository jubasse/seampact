<?php

declare(strict_types=1);

namespace Seampact\Hooks;

/** What the boundary claims before an idempotent write runs: the key, the request fingerprint and the key's lifetime. */
final readonly class IdempotencyClaim
{
    public function __construct(
        public string $key,
        public string $fingerprint,
        public int $lifetimeMs,
        public OperationRef $operation,
    ) {
    }
}
