<?php

declare(strict_types=1);

namespace Seampact\Hooks\Purpose;

use Seampact\Hooks\Purpose;

/** The requirement guards one sort key. */
final readonly class SortKey implements Purpose
{
    public function __construct(
        public string $key,
    ) {
    }
}
