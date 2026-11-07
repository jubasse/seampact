<?php

declare(strict_types=1);

namespace Seampact\Hooks\AuthenticateResult;

use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\ErrorCodeWithParams;

/** The request is not authenticated; the code is one of the identity's declared codes. */
final readonly class Denied implements AuthenticateResult
{
    public function __construct(
        public ErrorCodeWithParams $deny,
    ) {
    }
}
