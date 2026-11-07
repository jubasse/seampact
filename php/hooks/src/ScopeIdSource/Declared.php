<?php

declare(strict_types=1);

namespace Seampact\Hooks\ScopeIdSource;

use Seampact\Hooks\ScopeIdSource;

/** The id the contract declares, read from the request. */
final readonly class Declared implements ScopeIdSource
{
    public function __construct(
        public int|string|object $id,
    ) {
    }
}
