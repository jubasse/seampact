<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/**
 * The IR's wire form of path, query and header values (ADR 0003): each is text on the wire, read as the integer,
 * number or boolean its type names when the text spells one, and kept as text otherwise, so the step 6 type rule
 * reports it. The query is read from the raw query string with form decoding, never through PHP's `parse_str`.
 */
final class WireValues
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iD';
    private const INTEGER = '/^-?(0|[1-9][0-9]*)$/D';
    private const NUMBER = '/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/D';
    private const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    // `encodeURIComponent` keeps the unreserved set and `!*'()`; the RFC 3986 query set adds the sub-delims, `:@/?`.
    private const COMPONENT_SAFE = self::ALPHANUMERIC . '-_.!~*\'()';
    private const SHORTEST_NUMBER = '/^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/D';
    // `Number#toString` writes plain digits while the decimal point sits at most 21 digits right and 6 zeros left.
    private const DECIMAL_DIGITS_MAX = 21;
    private const DECIMAL_ZEROS_MIN = -6;
    private const QUERY_SAFE = self::ALPHANUMERIC . '-._~!$&\'()*+,;=:@/?';

    private function __construct()
    {
    }

    /**
     * The raw query's pairs without the members `$names`, every other pair kept as received and made link-safe.
     *
     * @param list<string> $names
     * @return list<string>
     */
    public static function keptQueryPairs(string $rawQuery, array $names): array
    {
        $kept = [];
        foreach (explode('&', $rawQuery) as $pair) {
            if ($pair === '' || in_array(urldecode(explode('=', $pair, 2)[0]), $names, true)) {
                continue;
            }
            $kept[] = self::linkSafe($pair);
        }

        return $kept;
    }

    /**
     * Bytes outside the RFC 3986 query set, and a `%` that starts no escape, percent-encoded, so a raw `>` or `"` the
     * server accepted cannot break a `Link` target built from the pair.
     */
    public static function linkSafe(string $pair): string
    {
        $safe = '';
        $length = strlen($pair);
        for ($index = 0; $index < $length; $index++) {
            $byte = $pair[$index];
            $escapeStart = $byte === '%' && $index + 2 < $length && ctype_xdigit(substr($pair, $index + 1, 2));
            $safe .= $escapeStart || ($byte !== '%' && str_contains(self::QUERY_SAFE, $byte)) ? $byte : sprintf('%%%02X', ord($byte));
        }

        return $safe;
    }

    /** `$text` as `encodeURIComponent` writes it: every byte outside the unreserved set and `!*'()` percent-encoded. */
    public static function componentEncoded(string $text): string
    {
        $encoded = '';
        $length = strlen($text);
        for ($index = 0; $index < $length; $index++) {
            $byte = $text[$index];
            $encoded .= str_contains(self::COMPONENT_SAFE, $byte) ? $byte : sprintf('%%%02X', ord($byte));
        }

        return $encoded;
    }

    /**
     * The path parameter `$name`'s value as one segment, as the generated clients send it: its wire text, encoded as
     * `componentEncoded` writes it.
     *
     * @throws \InvalidArgumentException for an empty, `.` or `..` text, which a URL parser reads as another route, or a text
     *     that is not UTF-8
     */
    public static function pathSegment(string $name, string|int|float|bool|\BackedEnum|\DateTimeInterface $value): string
    {
        $text = match (true) {
            $value instanceof \BackedEnum => (string) $value->value,
            $value instanceof \DateTimeInterface => $value->format(WireCodec::DATE_TIME_WIRE),
            is_bool($value) => $value ? 'true' : 'false',
            is_float($value) => self::numberText($name, $value),
            default => (string) $value,
        };

        if ($text === '' || $text === '.' || $text === '..') {
            throw new \InvalidArgumentException("The path parameter '{$name}' must be one non-empty segment, not '{$text}': it would reach another route.");
        }
        if (!mb_check_encoding($text, 'UTF-8')) {
            throw new \InvalidArgumentException("The path parameter '{$name}' must be UTF-8 text: the server answers another encoding with a 400.");
        }

        return self::componentEncoded($text);
    }

    /** A raw path segment percent-decoded, or null when its bytes are not UTF-8. */
    public static function decodedSegment(string $raw): ?string
    {
        $decoded = rawurldecode($raw);

        return mb_check_encoding($decoded, 'UTF-8') ? $decoded : null;
    }

    public static function pathValue(string $raw, mixed $type): mixed
    {
        $decoded = self::decodedSegment($raw);

        return $decoded === null ? $raw : self::scalar($decoded, $type);
    }

    /** The text of a parameter read as its type names. */
    public static function scalar(string $text, mixed $type): mixed
    {
        return match (Ir::string($type, 'kind') === 'scalar' ? Ir::string($type, 'type') : null) {
            'integer' => preg_match(self::INTEGER, $text) === 1 && is_int($integer = filter_var($text, FILTER_VALIDATE_INT)) ? $integer : $text,
            'number' => preg_match(self::NUMBER, $text) === 1 ? self::number($text) : $text,
            'boolean' => match ($text) {
                'true' => true,
                'false' => false,
                default => $text,
            },
            default => $text,
        };
    }

    /**
     * Each query member by name, form-decoded (`+` is a space), with all its values in order as received; `listItems`
     * decodes them, after splitting an unexploded list.
     *
     * @return array<string, list<string>>
     */
    public static function rawQuery(string $raw): array
    {
        $members = [];
        foreach (explode('&', $raw) as $pair) {
            if ($pair === '') {
                continue;
            }
            $parts = explode('=', $pair, 2);
            $members[urldecode($parts[0])][] = $parts[1] ?? '';
        }

        return $members;
    }

    /**
     * A parameter's values, form-decoded: a list written with `explode: false` is one comma-separated value (`sort=a,-b`).
     *
     * @param list<string> $values
     * @return list<string>
     */
    public static function listItems(array $values, mixed $wire): array
    {
        $unexploded = is_array($wire) && Ir::string($wire, 'kind') === 'list' && ($wire['explode'] ?? true) === false;

        $items = [];
        foreach ($values as $value) {
            // An unexploded list splits on raw commas only: an encoded `%2C` is data within one item.
            array_push($items, ...array_map(urldecode(...), $unexploded ? explode(',', $value) : [$value]));
        }

        return $items;
    }

    /**
     * A query parameter's values as its type reads them: an array parameter takes every value, a scalar one its only
     * value, and several values for a scalar stay a list, which the type rule refuses.
     *
     * @param list<string> $values
     */
    public static function queryValue(array $values, mixed $type): mixed
    {
        if (Ir::string($type, 'kind') === 'array') {
            return array_map(static fn (string $value): mixed => self::scalar($value, Ir::map($type, 'items')), $values);
        }

        return count($values) === 1 ? self::scalar($values[0], $type) : $values;
    }

    /**
     * The contract rule a scalar value breaks, null when it keeps its type, format, length and bounds: the check a
     * scope id, a subject id and a rule's proof get before any hook reads them.
     */
    public static function scalarIssue(mixed $type, mixed $value): ?string
    {
        $refinements = Ir::map($type, 'refinements');

        return match (Ir::string($type, 'type')) {
            'string' => match (true) {
                !is_string($value) => 'type',
                Ir::string($type, 'format') === 'uuid' && preg_match(self::UUID, $value) !== 1 => 'format',
                is_int($refinements['minLength'] ?? null) && mb_strlen($value) < $refinements['minLength'] => 'minLength',
                is_int($refinements['maxLength'] ?? null) && mb_strlen($value) > $refinements['maxLength'] => 'maxLength',
                default => null,
            },
            'integer' => is_int($value) ? null : 'type',
            'number' => is_int($value) || is_float($value) ? null : 'type',
            'boolean' => is_bool($value) ? null : 'type',
            default => null,
        };
    }

    /**
     * The shortest text that reads back as `$value`, as JavaScript's `String(value)` writes it: `3` for a whole number,
     * plain digits up to 1e21 and down to 1e-6, an exponent such as `1e+25` or `1.5e-7` outside that range.
     */
    private static function numberText(string $name, float $value): string
    {
        if (!is_finite($value)) {
            throw new \InvalidArgumentException("The path parameter '{$name}' must be a finite number, not {$value}.");
        }
        if ($value === 0.0) {
            return '0';
        }

        // PHP writes the shortest round-trip digits; read them as a digit run and the position of the decimal point.
        $shortest = json_encode(abs($value), JSON_THROW_ON_ERROR);
        if (preg_match(self::SHORTEST_NUMBER, $shortest, $parts) !== 1) {
            throw new \LogicException("PHP wrote the number {$value} as '{$shortest}', which is not a JSON number.");
        }

        $digitRun = $parts[1] . ($parts[2] ?? '');
        $leadingZeros = strlen($digitRun) - strlen(ltrim($digitRun, '0'));
        $digits = rtrim(ltrim($digitRun, '0'), '0');
        $pointPosition = strlen($parts[1]) - $leadingZeros + (int) ($parts[3] ?? 0);

        return ($value < 0 ? '-' : '') . self::javaScriptNumber($digits, $pointPosition);
    }

    /** `$digits` with the decimal point `$pointPosition` digits from their start, in the notation of `Number#toString`. */
    private static function javaScriptNumber(string $digits, int $pointPosition): string
    {
        $digitCount = strlen($digits);

        return match (true) {
            $digitCount <= $pointPosition && $pointPosition <= self::DECIMAL_DIGITS_MAX => $digits . str_repeat('0', $pointPosition - $digitCount),
            0 < $pointPosition && $pointPosition <= self::DECIMAL_DIGITS_MAX => substr($digits, 0, $pointPosition) . '.' . substr($digits, $pointPosition),
            self::DECIMAL_ZEROS_MIN < $pointPosition && $pointPosition <= 0 => '0.' . str_repeat('0', -$pointPosition) . $digits,
            default => $digits[0] . ($digitCount > 1 ? '.' . substr($digits, 1) : '') . 'e' . ($pointPosition > 0 ? '+' : '-') . abs($pointPosition - 1),
        };
    }

    private static function number(string $text): int|float
    {
        $integer = filter_var($text, FILTER_VALIDATE_INT);

        return is_int($integer) ? $integer : (float) $text;
    }
}
