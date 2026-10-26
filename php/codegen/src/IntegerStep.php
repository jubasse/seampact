<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/**
 * The exact integer step of a `multipleOf` on an integer (ADR 0003 keeps it on `integer` and decimal): an integer is
 * a multiple of `p / 10^d` exactly when it is a multiple of `p / gcd(p, 10^d)`, as the Node targets reduce it, so
 * `2.5` gives 5 and `0.07` gives 7.
 */
final class IntegerStep
{
    private const DECIMAL_LITERAL = '/^-?(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/D';
    // Up to 18 digits always fit a 64-bit `int`.
    private const MAX_INT_DIGITS = 18;

    private function __construct()
    {
    }

    public static function isNonzeroDecimal(string $literal): bool
    {
        return preg_match(self::DECIMAL_LITERAL, $literal, $parts) === 1 && trim($parts[1] . $parts[2], '0') !== '';
    }

    /** The reduced step, or null when it is beyond the PHP `int` range; the literal is a nonzero decimal. */
    public static function of(string $literal): ?int
    {
        if (preg_match(self::DECIMAL_LITERAL, $literal, $parts) !== 1 || trim($parts[1] . $parts[2], '0') === '') {
            throw new \InvalidArgumentException("The step '{$literal}' is not a nonzero decimal literal.");
        }

        $digits = ltrim($parts[1] . $parts[2], '0');
        $scale = strlen($parts[2]) - (int) ($parts[3] ?? '0');

        if ($scale <= 0) {
            $whole = $digits . str_repeat('0', -$scale);

            return strlen($whole) <= self::MAX_INT_DIGITS ? (int) $whole : null;
        }

        while ($scale > 0 && str_ends_with($digits, '0')) {
            $digits = substr($digits, 0, -1);
            $scale--;
        }

        if (strlen($digits) > self::MAX_INT_DIGITS) {
            return null;
        }

        return self::withoutFactor(self::withoutFactor((int) $digits, 2, $scale), 5, $scale);
    }

    // Divides out `$factor` at most `$times` times, the share of 10^scale the numerator holds.
    private static function withoutFactor(int $value, int $factor, int $times): int
    {
        for ($divided = 0; $divided < $times && $value % $factor === 0; $divided++) {
            $value = intdiv($value, $factor);
        }

        return $value;
    }
}
