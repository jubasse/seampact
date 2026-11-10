<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

/** The query of `scheduleTask`: an optional dry-run flag. */
final class ScheduleQuery
{
    public function __construct(public readonly ?bool $dryRun = null)
    {
    }
}
