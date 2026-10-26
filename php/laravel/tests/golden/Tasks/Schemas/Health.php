<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Schemas;

/**
 * The schema 'Health'.
 */
final readonly class Health
{
    public function __construct(
        public string $status,
    ) {
    }
}
