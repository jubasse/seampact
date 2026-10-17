<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

use PHPUnit\Framework\Assert;

/** The IR examples of the repository and the helpers that build variations of a document without recursion. */
final class Documents
{
    /** The repository root: `php/ir/tests/Support` is four levels below it. */
    public static function repositoryRoot(): string
    {
        return dirname(__DIR__, 4);
    }

    public static function exampleText(string $name): string
    {
        $text = file_get_contents(self::repositoryRoot() . '/packages/core/spec/schemas/ir/examples/' . $name);
        Assert::assertIsString($text, $name);

        return $text;
    }

    public static function example(string $name): \stdClass
    {
        $document = json_decode(self::exampleText($name), false, 512, JSON_THROW_ON_ERROR);
        Assert::assertInstanceOf(\stdClass::class, $document, $name);

        return $document;
    }

    /**
     * A copy of `$document` with `$value` at `$path` (object members and list positions); only the objects and
     * lists along the path are copied.
     *
     * @param list<string> $path
     */
    public static function replaceAt(\stdClass $document, array $path, mixed $value): \stdClass
    {
        $copy = clone $document;
        $step = array_shift($path);
        Assert::assertIsString($step);
        if ($path === []) {
            $copy->{$step} = $value;

            return $copy;
        }

        $child = $copy->{$step};
        $copy->{$step} = is_array($child)
            ? self::replaceInList($child, $path, $value)
            : self::replaceAt(self::asObject($child), $path, $value);

        return $copy;
    }

    /**
     * @param array<int|string, mixed> $list
     * @param list<string> $path
     * @return array<int|string, mixed>
     */
    private static function replaceInList(array $list, array $path, mixed $value): array
    {
        $position = (int) array_shift($path);
        $list[$position] = $path === [] ? $value : self::replaceAt(self::asObject($list[$position]), $path, $value);

        return $list;
    }

    /** The member at `$path` (object members and list positions) of a document. */
    public static function at(mixed $document, string ...$path): mixed
    {
        $value = $document;
        foreach ($path as $step) {
            $value = is_array($value) ? ($value[(int) $step] ?? null) : self::asObject($value)->{$step};
        }

        return $value;
    }

    public static function objectAt(mixed $document, string ...$path): \stdClass
    {
        return self::asObject(self::at($document, ...$path));
    }

    /**
     * A copy of `$document` without the member `$name` of the object at `$path`.
     *
     * @param list<string> $path
     */
    public static function withoutMember(\stdClass $document, array $path, string $name): \stdClass
    {
        $object = clone self::asObject(self::at($document, ...$path));
        unset($object->{$name});

        return $path === [] ? $object : self::replaceAt($document, $path, $object);
    }

    private static function asObject(mixed $value): \stdClass
    {
        Assert::assertInstanceOf(\stdClass::class, $value);

        return $value;
    }

    /** The same JSON with object members sorted, as text, so two documents compare up to member order. */
    public static function canonical(mixed $value): string
    {
        return json_encode(self::sorted($value), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    private static function sorted(mixed $value): mixed
    {
        if (is_array($value)) {
            return array_map(self::sorted(...), $value);
        }
        if (!$value instanceof \stdClass) {
            return $value;
        }

        $members = get_object_vars($value);
        ksort($members, SORT_STRING);
        $sorted = new \stdClass();
        foreach ($members as $name => $member) {
            $sorted->{(string) $name} = self::sorted($member);
        }

        return $sorted;
    }
}
