<?php

declare(strict_types=1);

namespace Seampact\Hooks\Purpose;

use Seampact\Hooks\Purpose;
use Seampact\Hooks\FieldDirection;

/** The requirement guards one field of the request or the response. */
final readonly class Field implements Purpose
{
    public function __construct(
        public string $pointer,
        public FieldDirection $direction,
    ) {
    }
}
