<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

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

    private static function number(string $text): int|float
    {
        $integer = filter_var($text, FILTER_VALIDATE_INT);

        return is_int($integer) ? $integer : (float) $text;
    }
}
