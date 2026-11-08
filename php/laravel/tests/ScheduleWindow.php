<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

/** The body of `scheduleTask`: a window with an optional note. */
final class ScheduleWindow
{
    public function __construct(public readonly string $start, public readonly string $end, public readonly ?string $note = null)
    {
    }
}
