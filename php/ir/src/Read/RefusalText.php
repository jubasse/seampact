<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

use Seampact\Ir\Model\IrHydration;

/** The text of a refusal: untrusted strings are cut, numbers shown plainly, pointers escaped. */
final class RefusalText
{
    private const MAX_MESSAGE_VALUE_LENGTH = 80;

    // A float is shown in plain form only when it is integral and has at most this many digits.
    private const MAX_PLAIN_FLOAT = 1.0e15;

    /**
     * An untrusted string cut for a message; the refusal's other members keep it whole. A string that is not
     * UTF-8, which only the pointer of a malformed text can be, is cut at a byte.
     */
    public static function inMessage(string $value): string
    {
        if (strlen($value) <= self::MAX_MESSAGE_VALUE_LENGTH) {
            return $value;
        }

        $matched = preg_match('/^.{' . self::MAX_MESSAGE_VALUE_LENGTH . '}/su', $value, $characters);
        $cut = $matched === 1 ? $characters[0] : substr($value, 0, self::MAX_MESSAGE_VALUE_LENGTH);

        return $cut === $value ? $value : $cut . '...';
    }

    /** A member name as one JSON Pointer segment (RFC 6901). */
    public static function escapePointerSegment(string $member): string
    {
        return str_replace(['~', '/'], ['~0', '~1'], $member);
    }

    public static function jsonType(mixed $value): string
    {
        return $value === Missing::Absent ? 'missing' : IrHydration::jsonType($value);
    }

    /**
     * A string as is, a number in plain form, 'true', 'false' or 'null', and an array or object by its JSON
     * type: rendering a container would copy any amount of untrusted input into every refusal.
     */
    public static function shown(mixed $value): string
    {
        return match (true) {
            is_string($value) => $value,
            is_int($value) => (string) $value,
            is_float($value) => self::shownFloat($value),
            is_bool($value) => $value ? 'true' : 'false',
            default => self::jsonType($value),
        };
    }

    private static function shownFloat(float $value): string
    {
        if (is_finite($value) && floor($value) === $value && abs($value) < self::MAX_PLAIN_FLOAT) {
            return sprintf('%.0f', $value);
        }

        return (string) $value;
    }
}
