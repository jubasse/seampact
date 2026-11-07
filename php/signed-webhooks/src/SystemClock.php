<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The system clock. */
final class SystemClock implements Clock
{
    private const MILLISECONDS_PER_SECOND = 1000;

    public function nowMilliseconds(): int
    {
        return (int) floor(microtime(true) * self::MILLISECONDS_PER_SECOND);
    }
}
