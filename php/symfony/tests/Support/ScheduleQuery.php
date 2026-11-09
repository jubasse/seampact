<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

/** The query part of `scheduleTask`. */
final class ScheduleQuery
{
    public function __construct(public readonly ?bool $dryRun = null)
    {
    }
}
