<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/** A deeply nested value as JSON text and as the same parsed value, built without recursion. */
final readonly class Deep
{
    public function __construct(public string $text, public mixed $value)
    {
    }

    public static function arrays(int $levels): self
    {
        $value = 0;
        for ($level = 0; $level < $levels; ++$level) {
            $value = [$value];
        }

        return new self(str_repeat('[', $levels) . '0' . str_repeat(']', $levels), $value);
    }

    public static function objects(int $levels): self
    {
        $value = 0;
        for ($level = 0; $level < $levels; ++$level) {
            $object = new \stdClass();
            $object->a = $value;
            $value = $object;
        }

        return new self(str_repeat('{"a":', $levels) . '0' . str_repeat('}', $levels), $value);
    }

    /** Array type uses nested `$levels` deep around a string scalar, whose refinements are one level more. */
    public static function arrayTypeUses(int $levels): self
    {
        $scalarText = '{"kind":"scalar","type":"string","refinements":{}}';
        $value = json_decode($scalarText, false, 512, JSON_THROW_ON_ERROR);
        for ($level = 0; $level < $levels; ++$level) {
            $use = new \stdClass();
            $use->kind = 'array';
            $use->items = $value;
            $value = $use;
        }

        return new self(str_repeat('{"kind":"array","items":', $levels) . $scalarText . str_repeat('}', $levels), $value);
    }
}
