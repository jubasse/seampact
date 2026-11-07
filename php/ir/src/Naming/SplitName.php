<?php

declare(strict_types=1);

namespace Seampact\Ir\Naming;

/** Splitting a written name into segments (ADR 0007 section 2). */
final class SplitName
{
    private const OTHER = 0;

    private const LOWER = 1;

    private const UPPER = 2;

    private const DIGIT = 3;

    /**
     * Splits a written name with the four rules of ADR 0007 section 2. Total: any string gives a possibly empty list
     * of non-empty `[a-z0-9]+` segments. Only ASCII bytes are looked at, so the result never depends on a locale.
     *
     * @return list<string>
     */
    public static function split(string $written): array
    {
        $segments = [];
        $start = -1;
        $length = strlen($written);

        for ($index = 0; $index < $length; $index++) {
            $kind = self::kindOf($written[$index]);

            if ($kind === self::OTHER) {
                if ($start >= 0) {
                    $segments[] = strtolower(substr($written, $start, $index - $start));
                }
                $start = -1;
                continue;
            }

            if ($start < 0) {
                $start = $index;
                continue;
            }

            if ($kind !== self::UPPER) {
                continue;
            }

            $previous = self::kindOf($written[$index - 1]);
            $next = $index + 1 < $length ? self::kindOf($written[$index + 1]) : self::OTHER;

            // An uppercase letter after a lowercase letter or a digit starts a segment; so does one that ends an
            // uppercase run and is followed by a lowercase letter (`HTTPServer`).
            if ($previous === self::LOWER || $previous === self::DIGIT || ($previous === self::UPPER && $next === self::LOWER)) {
                $segments[] = strtolower(substr($written, $start, $index - $start));
                $start = $index;
            }
        }

        if ($start >= 0) {
            $segments[] = strtolower(substr($written, $start));
        }

        return $segments;
    }

    /**
     * The segments of a written name in its context (ADR 0007 section 2, last paragraph), or null when it has none
     * (`no-segment`): a `$codeName` replaces the split of `$written` and never falls back; an enum value without a
     * segment becomes `value<position>`, `$position` being one-based and required for an enum value.
     *
     * @return list<string>|null
     * @throws \InvalidArgumentException an enum value without a positive position
     */
    public static function segmentsOf(string $written, NameSource $source, ?string $codeName = null, ?int $position = null): ?array
    {
        if ($source === NameSource::EnumValue && ($position === null || $position < 1)) {
            throw new \InvalidArgumentException('an enum value needs its one-based position, got ' . ($position ?? 'none'));
        }

        $split = self::split($codeName ?? $written);

        if ($split !== []) {
            return $split;
        }

        if ($source === NameSource::EnumValue && $codeName === null) {
            return ['value' . $position];
        }

        return null;
    }

    private static function kindOf(string $character): int
    {
        $code = ord($character);

        return match (true) {
            $code >= ord('a') && $code <= ord('z') => self::LOWER,
            $code >= ord('A') && $code <= ord('Z') => self::UPPER,
            $code >= ord('0') && $code <= ord('9') => self::DIGIT,
            default => self::OTHER,
        };
    }
}
