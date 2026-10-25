<?php

declare(strict_types=1);

namespace Seampact\Hooks\AuthenticateResult;

use Seampact\Hooks\AuthenticateResult;

/** The request is authenticated as this principal. */
final readonly class Authenticated implements AuthenticateResult
{
    public function __construct(
        public object $principal,
    ) {
    }
}
