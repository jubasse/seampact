<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * Typed reads of the IR view the generator wrote as PHP arrays: a missing member reads as an empty map or list, or
 * null, so the boundary never indexes past a member the contract does not carry.
 */
final class Ir
{
    private function __construct()
    {
    }

    /** @return array<array-key, mixed> */
    public static function map(mixed $node, string|int $key): array
    {
        $value = is_array($node) ? ($node[$key] ?? null) : null;

        return is_array($value) ? $value : [];
    }

    /** @return list<mixed> */
    public static function list(mixed $node, string|int $key): array
    {
        return array_values(self::map($node, $key));
    }

    /** @return list<array<array-key, mixed>> each member of the list that is a map */
    public static function maps(mixed $node, string|int $key): array
    {
        return array_values(array_filter(self::list($node, $key), is_array(...)));
    }

    public static function string(mixed $node, string|int $key): ?string
    {
        $value = is_array($node) ? ($node[$key] ?? null) : null;

        return is_string($value) ? $value : null;
    }

    public static function int(mixed $node, string|int $key): ?int
    {
        $value = is_array($node) ? ($node[$key] ?? null) : null;

        return is_int($value) ? $value : null;
    }

    public static function true(mixed $node, string|int $key): bool
    {
        return is_array($node) && ($node[$key] ?? null) === true;
    }

    public static function has(mixed $node, string|int $key): bool
    {
        return is_array($node) && array_key_exists($key, $node);
    }

    /** @return list<string> */
    public static function strings(mixed $node, string|int $key): array
    {
        return array_values(array_filter(self::list($node, $key), is_string(...)));
    }
}
