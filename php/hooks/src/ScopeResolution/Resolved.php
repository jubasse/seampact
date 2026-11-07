<?php

declare(strict_types=1);

namespace Seampact\Hooks\ScopeResolution;

use Seampact\Hooks\ScopeResolution;
use Seampact\Hooks\ResolvedScope;

/** The scope is resolved. */
final readonly class Resolved implements ScopeResolution
{
    public function __construct(
        public ResolvedScope $resolved,
    ) {
    }
}
