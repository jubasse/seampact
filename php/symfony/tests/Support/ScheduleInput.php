<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

/** The typed input of `scheduleTask` in InputRulesContract. */
final class ScheduleInput
{
    public function __construct(public readonly ScheduleQuery $query, public readonly ScheduleHeaders $headers, public readonly ScheduleWindow $body)
    {
    }
}
