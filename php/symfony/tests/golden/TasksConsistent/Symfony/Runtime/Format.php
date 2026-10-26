<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/** A string format the target checks itself (ADR 0003): a hyphenated UUID, or an RFC 3339 date-time with its offset. */
enum Format
{
    case Uuid;
    case DateTime;

    private const UUID_PATTERN = '/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/D';
    private const DATE_TIME_PATTERN = '/^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/D';
    private const LAST_HOUR = 23;
    private const LAST_MINUTE = 59;
    // RFC 3339 allows a leap second.
    private const LAST_SECOND = 60;

    public function accepts(string $value): bool
    {
        return match ($this) {
            self::Uuid => preg_match(self::UUID_PATTERN, $value) === 1,
            self::DateTime => self::isDateTime($value),
        };
    }

    private static function isDateTime(string $value): bool
    {
        if (preg_match(self::DATE_TIME_PATTERN, $value, $parts) !== 1) {
            return false;
        }

        $offsetHour = (int) ($parts[7] ?? 0);
        $offsetMinute = (int) ($parts[8] ?? 0);

        return checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1])
            && (int) $parts[4] <= self::LAST_HOUR
            && (int) $parts[5] <= self::LAST_MINUTE
            && (int) $parts[6] <= self::LAST_SECOND
            && $offsetHour <= self::LAST_HOUR
            && $offsetMinute <= self::LAST_MINUTE;
    }
}
