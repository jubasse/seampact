<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** Reads and copies of a JSON value decoded with objects as `stdClass`, once a schema fixed each member's type. */
final class JsonValue
{
    private function __construct()
    {
    }

    /** A deep copy: a stored value never shares an object with the value it came from. */
    public static function copy(mixed $value): mixed
    {
        if ($value instanceof \stdClass) {
            $copy = new \stdClass();
            foreach (get_object_vars($value) as $name => $member) {
                $copy->{$name} = self::copy($member);
            }

            return $copy;
        }

        if (is_array($value)) {
            return array_map(self::copy(...), $value);
        }

        return $value;
    }

    public static function string(mixed $object, string $member): ?string
    {
        $value = self::member($object, $member);

        return is_string($value) ? $value : null;
    }

    public static function bool(mixed $object, string $member): ?bool
    {
        $value = self::member($object, $member);

        return is_bool($value) ? $value : null;
    }

    public static function object(mixed $object, string $member): ?\stdClass
    {
        $value = self::member($object, $member);

        return $value instanceof \stdClass ? $value : null;
    }

    /** @return ?list<mixed> */
    public static function list(mixed $object, string $member): ?array
    {
        $value = self::member($object, $member);

        return is_array($value) && array_is_list($value) ? $value : null;
    }

    /** @return ?list<string> */
    public static function strings(mixed $object, string $member): ?array
    {
        $items = self::list($object, $member);

        return $items === null ? null : array_values(array_filter($items, is_string(...)));
    }

    public static function has(mixed $object, string $member): bool
    {
        return $object instanceof \stdClass && property_exists($object, $member);
    }

    public static function member(mixed $object, string $member): mixed
    {
        return $object instanceof \stdClass && property_exists($object, $member) ? $object->{$member} : null;
    }
}
