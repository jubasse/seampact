<?php

declare(strict_types=1);

namespace Seampact\Hooks\IdempotencyBegin;

use Seampact\Hooks\IdempotencyBegin;

/** A write with this key is still running. */
final readonly class Running implements IdempotencyBegin
{
}
