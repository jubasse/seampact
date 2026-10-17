<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

use PHPUnit\Framework\Assert;

/** Typed reads of decoded JSON (objects as `stdClass`), so a test fails with a message instead of reading `mixed`. */
final class Json
{
    public static function object(mixed $value): \stdClass
    {
        Assert::assertInstanceOf(\stdClass::class, $value);

        return $value;
    }

    /** @return list<mixed> */
    public static function list(mixed $value): array
    {
        Assert::assertIsArray($value);

        return array_values($value);
    }

    public static function has(\stdClass $object, string $member): bool
    {
        return property_exists($object, $member);
    }

    public static function member(\stdClass $object, string $member): mixed
    {
        Assert::assertTrue(self::has($object, $member), "member $member is missing");

        return $object->{$member};
    }

    public static function string(\stdClass $object, string $member): string
    {
        $value = self::member($object, $member);
        Assert::assertIsString($value, $member);

        return $value;
    }

    public static function int(\stdClass $object, string $member): int
    {
        $value = self::member($object, $member);
        Assert::assertIsInt($value, $member);

        return $value;
    }

    public static function optionalString(\stdClass $object, string $member): ?string
    {
        return self::has($object, $member) ? self::string($object, $member) : null;
    }

    public static function optionalInt(\stdClass $object, string $member): ?int
    {
        return self::has($object, $member) ? self::int($object, $member) : null;
    }

    /** @return list<string> */
    public static function strings(\stdClass $object, string $member): array
    {
        return array_map(static function (mixed $item): string {
            Assert::assertIsString($item);

            return $item;
        }, self::list(self::member($object, $member)));
    }

    /** @return list<\stdClass> */
    public static function objects(\stdClass $object, string $member): array
    {
        return array_map(self::object(...), self::list(self::member($object, $member)));
    }

    /** @return list<\stdClass> an absent member is an empty list */
    public static function optionalObjects(\stdClass $object, string $member): array
    {
        return self::has($object, $member) ? self::objects($object, $member) : [];
    }

    public static function decodeFile(string $path): mixed
    {
        $text = file_get_contents($path);
        Assert::assertIsString($text, $path);

        return json_decode($text, false, 512, JSON_THROW_ON_ERROR);
    }
}
