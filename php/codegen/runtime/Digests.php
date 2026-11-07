<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * The SHA-256 digests of the boundary (the idempotency key and fingerprint, the throttle bucket key, the strong ETag),
 * over the text `JSON.stringify` writes with object members sorted by name, so every target derives the same key from
 * the same values (ADR 0023 "Query and bounded values").
 */
final class Digests
{
    private const STRING_FLAGS = JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
        | JSON_UNESCAPED_LINE_TERMINATORS;
    private const FLOAT_FLAGS = JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION;
    // `JSON.stringify` writes an exponent from 1e21 up and below 1e-6.
    private const PLAIN_UPPER_EXPONENT = 21;
    private const PLAIN_LOWER_EXPONENT = -6;
    // 2^32 - 1, the first integer that is not an array index in JavaScript.
    private const NOT_AN_INDEX = 4294967295;
    private const INDEX_NAME = '/^(?:0|[1-9][0-9]{0,9})$/D';
    private const DECIMAL_TEXT = '/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/D';

    private function __construct()
    {
    }

    /**
     * The SHA-256 of the canonical JSON of `$parts`, as lowercase hex.
     *
     * @param list<mixed> $parts
     */
    public static function hexOf(array $parts): string
    {
        return hash('sha256', self::canonical($parts));
    }

    /**
     * The SHA-256 of the canonical JSON of `$parts`, as unpadded base64url.
     *
     * @param list<mixed> $parts
     */
    public static function base64UrlOf(array $parts): string
    {
        return self::base64Url(hash('sha256', self::canonical($parts), true));
    }

    /** The SHA-256 of `$bytes`, as unpadded base64url. */
    public static function base64UrlOfBytes(string $bytes): string
    {
        return self::base64Url(hash('sha256', $bytes, true));
    }

    /**
     * `$value` as `JSON.stringify` writes it, object members sorted by name: a `stdClass` or a string-keyed array is an
     * object, a list is an array, and any other object is read through its JSON encoding.
     */
    public static function canonical(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_int($value) => (string) $value,
            is_float($value) => self::number($value),
            is_string($value) => json_encode($value, self::STRING_FLAGS),
            is_array($value) && array_is_list($value) => '[' . implode(',', array_map(self::canonical(...), $value)) . ']',
            is_array($value), $value instanceof \stdClass => self::object((array) $value),
            is_object($value) => self::canonical(json_decode(json_encode($value, self::STRING_FLAGS), false, 512, JSON_THROW_ON_ERROR)),
            default => throw new \LogicException('seampact: a digest cannot read a ' . get_debug_type($value) . '.'),
        };
    }

    /** @param array<array-key, mixed> $members */
    private static function object(array $members): string
    {
        $names = array_map(strval(...), array_keys($members));
        usort($names, self::compareNames(...));

        $written = [];
        foreach ($names as $name) {
            $written[] = json_encode($name, self::STRING_FLAGS) . ':' . self::canonical($members[$name]);
        }

        return '{' . implode(',', $written) . '}';
    }

    // Array-index names first in numeric order, as every JavaScript object orders its own keys, then the others by
    // UTF-16 code units, as JavaScript's default sort compares them.
    private static function compareNames(string $left, string $right): int
    {
        $byIndex = self::arrayIndexOf($left) <=> self::arrayIndexOf($right);
        if ($byIndex !== 0) {
            return $byIndex;
        }

        return strcmp(mb_convert_encoding($left, 'UTF-16BE', 'UTF-8'), mb_convert_encoding($right, 'UTF-16BE', 'UTF-8'));
    }

    private static function arrayIndexOf(string $name): int
    {
        if (preg_match(self::INDEX_NAME, $name) !== 1) {
            return self::NOT_AN_INDEX;
        }

        return min((int) $name, self::NOT_AN_INDEX);
    }

    // A number as JavaScript prints its double: the shortest digits, plain between 1e-6 and 1e21, an exponent outside.
    private static function number(float $value): string
    {
        if (!is_finite($value)) {
            return 'null';
        }
        if ($value === 0.0) {
            return '0';
        }

        $text = json_encode($value, self::FLOAT_FLAGS);
        if (preg_match(self::DECIMAL_TEXT, $text, $parts) !== 1) {
            throw new \LogicException("seampact: the number {$text} has no decimal form.");
        }

        $sign = $parts[1];
        $fraction = $parts[3] ?? '';
        $digits = ltrim($parts[2] . $fraction, '0');
        $exponent = (int) ($parts[4] ?? '0') + strlen($parts[2]) - 1 - (strlen($parts[2] . $fraction) - strlen($digits));
        $digits = rtrim($digits, '0');

        if ($exponent >= self::PLAIN_UPPER_EXPONENT || $exponent < self::PLAIN_LOWER_EXPONENT) {
            $mantissa = strlen($digits) === 1 ? $digits : $digits[0] . '.' . substr($digits, 1);

            return $sign . $mantissa . 'e' . ($exponent < 0 ? '-' : '+') . abs($exponent);
        }

        if ($exponent < 0) {
            return $sign . '0.' . str_repeat('0', -$exponent - 1) . $digits;
        }

        $integral = str_pad(substr($digits, 0, $exponent + 1), $exponent + 1, '0');
        $decimals = substr($digits, $exponent + 1);

        return $sign . $integral . ($decimals === '' ? '' : '.' . $decimals);
    }

    private static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
