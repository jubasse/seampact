<?php

declare(strict_types=1);

namespace Seampact\SignedWebhooks;

/** The current time the timestamp tolerance is checked against; a test passes a fixed one. */
interface Clock
{
    /** Milliseconds since the Unix epoch. */
    public function nowMilliseconds(): int;
}
