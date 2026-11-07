<?php

declare(strict_types=1);

namespace Seampact\Hooks\IdempotencyBegin;

use Seampact\Hooks\IdempotencyBegin;

/** The key is new: the write runs. */
final readonly class Started implements IdempotencyBegin
{
}
