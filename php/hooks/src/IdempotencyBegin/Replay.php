<?php

declare(strict_types=1);

namespace Seampact\Hooks\IdempotencyBegin;

use Seampact\Hooks\IdempotencyBegin;
use Seampact\Hooks\StoredResponse;

/** The write already completed: its stored response is replayed. */
final readonly class Replay implements IdempotencyBegin
{
    public function __construct(
        public StoredResponse $response,
    ) {
    }
}
