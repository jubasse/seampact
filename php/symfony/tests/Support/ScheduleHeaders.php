<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

/** The header part of `scheduleTask`. */
final class ScheduleHeaders
{
    public function __construct(public readonly string $xTenant)
    {
    }
}
