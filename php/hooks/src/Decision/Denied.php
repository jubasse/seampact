<?php

declare(strict_types=1);

namespace Seampact\Hooks\Decision;

use Seampact\Hooks\Decision;
use Seampact\Hooks\ErrorCodeWithParams;

/** The requirement is not met; the code is one of the requirement's declared codes, with its params. */
final readonly class Denied implements Decision
{
    public function __construct(
        public ErrorCodeWithParams $deny,
    ) {
    }
}
