<?php

declare(strict_types=1);

namespace Seampact\Hooks\ScopeResolution;

use Seampact\Hooks\ScopeResolution;
use Seampact\Hooks\ErrorCodeWithParams;

/** The scope is not resolved; the code is one of the scope's declared codes. */
final readonly class Denied implements ScopeResolution
{
    public function __construct(
        public ErrorCodeWithParams $deny,
    ) {
    }
}
