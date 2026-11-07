<?php

declare(strict_types=1);

namespace Seampact\Hooks\IdempotencyBegin;

use Seampact\Hooks\IdempotencyBegin;

/** The key was used with another request fingerprint. */
final readonly class Mismatch implements IdempotencyBegin
{
}
