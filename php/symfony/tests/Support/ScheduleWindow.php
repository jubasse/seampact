<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

/** The body of `scheduleTask`. */
final class ScheduleWindow
{
    /** @param list<mixed> $tags */
    public function __construct(public readonly string $start, public readonly string $end, public readonly ?string $note = null, public readonly array $tags = [])
    {
    }
}
