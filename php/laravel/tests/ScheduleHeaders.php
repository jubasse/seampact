<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

/** The headers of `scheduleTask`: the tenant. */
final class ScheduleHeaders
{
    public function __construct(public readonly string $xTenant)
    {
    }
}
