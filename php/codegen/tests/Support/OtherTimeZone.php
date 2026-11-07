<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Support;

/** A run under a time zone ahead of UTC, so a generator that reads the clock's zone shows it in its output. */
final class OtherTimeZone
{
    private const ZONE_AHEAD_OF_UTC = 'Pacific/Kiritimati';

    /**
     * What [$run] returns under the other time zone; the default zone is restored after it.
     *
     * @template T
     * @param callable(): T $run
     * @return T
     */
    public static function run(callable $run): mixed
    {
        $defaultZone = date_default_timezone_get();
        date_default_timezone_set(self::ZONE_AHEAD_OF_UTC);

        try {
            return $run();
        } finally {
            date_default_timezone_set($defaultZone);
        }
    }
}
