<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** RFC 3339 `date-time` strings and whether the targets' own check accepts them; Laravel and Symfony read the same table. */
final class DateTimeVectors
{
    private function __construct()
    {
    }

    /** @return iterable<string, array{string, bool}> */
    public static function all(): iterable
    {
        yield 'UTC with Z' => ['2026-11-07T10:30:00Z', true];
        yield 'lower-case t and z' => ['2026-11-07t10:30:00z', true];
        yield 'positive offset' => ['2026-11-07T10:30:00+01:00', true];
        yield 'the largest offset' => ['2026-11-07T10:30:00+14:00', true];
        yield 'unknown local offset' => ['2026-11-07T10:30:00-00:00', true];
        yield 'fraction digits' => ['2026-11-07T10:30:00.123456789Z', true];
        yield 'a leap day in a leap year' => ['2024-02-29T00:00:00Z', true];
        yield 'a leap second' => ['2016-12-31T23:59:60Z', true];
        yield 'the last second of the day' => ['2026-11-07T23:59:59Z', true];
        yield 'day 31 of a 31-day month' => ['2026-12-31T00:00:00Z', true];

        yield 'a leap day in a common year' => ['2026-02-29T00:00:00Z', false];
        yield 'a leap day in a century year' => ['1900-02-29T00:00:00Z', false];
        yield 'day 31 of a 30-day month' => ['2026-11-31T00:00:00Z', false];
        yield 'month 13' => ['2026-13-01T00:00:00Z', false];
        yield 'month 0' => ['2026-00-10T00:00:00Z', false];
        yield 'day 0' => ['2026-11-00T00:00:00Z', false];
        yield 'hour 24' => ['2026-11-07T24:00:00Z', false];
        yield 'minute 60' => ['2026-11-07T10:60:00Z', false];
        yield 'second 61' => ['2026-11-07T10:30:61Z', false];
        yield 'offset hour 24' => ['2026-11-07T10:30:00+24:00', false];
        yield 'offset minute 60' => ['2026-11-07T10:30:00+01:60', false];
        yield 'no offset' => ['2026-11-07T10:30:00', false];
        yield 'offset without a colon' => ['2026-11-07T10:30:00+0100', false];
        yield 'a date only' => ['2026-11-07', false];
        yield 'a space instead of T' => ['2026-11-07 10:30:00Z', false];
        yield 'an empty fraction' => ['2026-11-07T10:30:00.Z', false];
        yield 'a two-digit year' => ['26-11-07T10:30:00Z', false];
        yield 'a trailing newline' => ["2026-11-07T10:30:00Z\n", false];
        yield 'leading whitespace' => [' 2026-11-07T10:30:00Z', false];
        yield 'non-ASCII digits' => ["\u{0662}026-11-07T10:30:00Z", false];
        yield 'the empty string' => ['', false];
    }
}
