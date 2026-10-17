<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/**
 * Reads the output of json_decode($text) (objects as stdClass, no associative mode) into the model and writes
 * the model back as data json_encode turns into the same document. A map is a PHP array whose keys are strings
 * in the document but integers in PHP when they look like one ("1042"): read a key with (string) $key. The
 * encoder writes every key back as a string, and an empty map as {}.
 *
 * Every message names the definition and member and the JSON type found, never the value.
 */
final class IrHydration
{
    private const MAX_EXACT_FLOAT_INTEGER = 9007199254740992.0;

    public static function jsonType(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => 'boolean',
            is_int($value), is_float($value) => 'number',
            is_string($value) => 'string',
            is_array($value) => 'array',
            default => 'object',
        };
    }

    public static function object(mixed $value, string $at): \stdClass
    {
        if ($value instanceof \stdClass) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a JSON object, got the JSON type %s', $at, self::jsonType($value)));
    }

    /** A deep copy of decoded JSON, so that the model never shares a value with its caller. */
    public static function copy(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            return self::copyObject($value);
        }

        return is_array($value) ? array_map(self::copy(...), $value) : $value;
    }

    public static function copyObject(\stdClass $value): \stdClass
    {
        $copy = new \stdClass();
        foreach (get_object_vars($value) as $name => $member) {
            $copy->{(string) $name} = self::copy($member);
        }

        return $copy;
    }

    public static function string(mixed $value, string $at): string
    {
        if (is_string($value)) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a string, got the JSON type %s', $at, self::jsonType($value)));
    }

    public static function boolean(mixed $value, string $at): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        throw new IrModelException(sprintf('%s: expected a boolean, got the JSON type %s', $at, self::jsonType($value)));
    }

    /** An IR integer: a JSON integer, or a number written with a fraction of zero ('2.0') within 2^53. */
    public static function integer(mixed $value, string $at): int
    {
        if (is_int($value)) {
            return $value;
        }
        if (!is_float($value)) {
            throw new IrModelException(sprintf('%s: expected an integer, got the JSON type %s', $at, self::jsonType($value)));
        }
        if (floor($value) !== $value || abs($value) > self::MAX_EXACT_FLOAT_INTEGER) {
            throw new IrModelException(sprintf('%s: expected an integer within 2^53', $at));
        }

        return (int) $value;
    }

    public static function required(\stdClass $members, string $name, string $at): mixed
    {
        if (!property_exists($members, $name)) {
            throw new IrModelException(sprintf("%s: the member '%s' is missing", $at, $name));
        }

        return $members->{$name};
    }

    /**
     * An optional member: absent and a JSON null are both null.
     *
     * @template T
     * @param callable(mixed): T $hydrate
     * @return T|null
     */
    public static function optional(\stdClass $members, string $name, callable $hydrate): mixed
    {
        if (!property_exists($members, $name) || $members->{$name} === null) {
            return null;
        }

        return $hydrate($members->{$name});
    }

    /** An optional opaque member: absent is 'null', a JSON 'null' is 'IrOpaque(null)'. */
    public static function optionalOpaque(\stdClass $members, string $name): ?IrOpaque
    {
        return property_exists($members, $name) ? new IrOpaque($members->{$name}) : null;
    }

    /** The tag of a union object: a string member, or an error naming the union. */
    public static function unionTag(\stdClass $members, string $name, string $at): string
    {
        $tag = $members->{$name} ?? null;
        if (!is_string($tag)) {
            throw new IrModelException(sprintf("%s: the tag member '%s' is missing or not a string", $at, $name));
        }

        return $tag;
    }

    /** A variant read on its own must carry its own tag. */
    public static function tag(\stdClass $members, string $name, string $expected, string $at): void
    {
        if (self::unionTag($members, $name, $at) !== $expected) {
            throw new IrModelException(sprintf("%s: the tag member '%s' is not '%s'", $at, $name, $expected));
        }
    }

    /**
     * @template T
     * @param callable(mixed): T $hydrate
     * @return list<T>
     */
    public static function listOf(mixed $value, string $at, callable $hydrate): array
    {
        if (!is_array($value)) {
            throw new IrModelException(sprintf('%s: expected a JSON array, got the JSON type %s', $at, self::jsonType($value)));
        }

        $items = [];
        foreach ($value as $item) {
            $items[] = $hydrate($item);
        }

        return $items;
    }

    /**
     * @template T
     * @param callable(mixed): T $hydrate
     * @return array<int|string, T>
     */
    public static function mapOf(mixed $value, string $at, callable $hydrate): array
    {
        return array_map($hydrate, get_object_vars(self::object($value, $at)));
    }

    /**
     * @template T
     * @param list<T> $items
     * @param callable(T): mixed $encode
     * @return list<mixed>
     */
    public static function encodeList(array $items, callable $encode): array
    {
        return array_map($encode, $items);
    }

    /**
     * A map as an object, so that an empty map is {} and a key like 1042 stays a string.
     *
     * @template T
     * @param array<int|string, T> $map
     * @param (callable(T): mixed)|null $encode
     */
    public static function encodeMap(array $map, ?callable $encode = null): \stdClass
    {
        $json = new \stdClass();
        foreach ($map as $key => $item) {
            $json->{(string) $key} = $encode === null ? $item : $encode($item);
        }

        return $json;
    }
}
