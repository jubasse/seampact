<?php

declare(strict_types=1);

namespace Seampact\Codegen\Runtime;

/**
 * Renders an IR template (ADR 0004 section 8) over its slots: the format's error body and a role's params. A slot
 * with no value renders as missing; an object member that renders as missing is left out, or written as `null` when
 * the format says `absent: null`.
 */
final class Templates
{
    private const ITEM_SLOT = 'item';

    private function __construct()
    {
    }

    /** @param array<string, mixed> $slots */
    public static function render(mixed $template, array $slots, bool $writeNulls): Rendered
    {
        return match (Ir::string($template, 'kind')) {
            'object' => self::object($template, $slots, $writeNulls),
            'array' => self::array($template, $slots, $writeNulls),
            'slot' => self::slot($template, $slots),
            'text' => self::text($template, $slots),
            'literal' => Rendered::of(is_array($template) ? ($template['value'] ?? null) : null),
            'each' => self::each($template, $slots, $writeNulls),
            default => throw new \LogicException('seampact: the template kind ' . var_export(Ir::string($template, 'kind'), true) . ' is not one the boundary renders.'),
        };
    }

    /** @param array<string, mixed> $slots */
    private static function object(mixed $template, array $slots, bool $writeNulls): Rendered
    {
        $object = new \stdClass();
        foreach (Ir::maps($template, 'members') as $member) {
            $name = self::memberName(Ir::map($member, 'name'), $slots);
            if ($name === null) {
                continue;
            }
            $value = self::render($member['value'] ?? null, $slots, $writeNulls);
            if ($value->present) {
                $object->{$name} = $value->value;
            } elseif ($writeNulls) {
                $object->{$name} = null;
            }
        }

        $merge = Ir::string($template, 'merge');
        $merged = $merge === null ? null : ($slots[$merge] ?? null);
        if ($merged instanceof \stdClass) {
            foreach (get_object_vars($merged) as $name => $value) {
                $object->{$name} = $value;
            }
        }

        return get_object_vars($object) === [] ? Rendered::missing() : Rendered::of($object);
    }

    /**
     * @param array<array-key, mixed> $name
     * @param array<string, mixed> $slots
     */
    private static function memberName(array $name, array $slots): ?string
    {
        if (Ir::string($name, 'kind') === 'text') {
            return Ir::string($name, 'text');
        }
        $value = $slots[Ir::string($name, 'slot') ?? ''] ?? null;

        return is_string($value) || is_int($value) ? (string) $value : null;
    }

    /** @param array<string, mixed> $slots */
    private static function array(mixed $template, array $slots, bool $writeNulls): Rendered
    {
        $items = [];
        foreach (Ir::list($template, 'items') as $item) {
            $value = self::render($item, $slots, $writeNulls);
            if ($value->present) {
                $items[] = $value->value;
            }
        }

        return Rendered::of($items);
    }

    /** @param array<string, mixed> $slots */
    private static function each(mixed $template, array $slots, bool $writeNulls): Rendered
    {
        $source = $slots[Ir::string($template, 'of') ?? ''] ?? null;
        if (!is_array($source)) {
            return Rendered::missing();
        }

        $items = [];
        foreach ($source as $item) {
            $value = self::render(Ir::map($template, 'as'), [...$slots, self::ITEM_SLOT => $item], $writeNulls);
            if ($value->present) {
                $items[] = $value->value;
            }
        }

        return Rendered::of($items);
    }

    /** @param array<string, mixed> $slots */
    private static function text(mixed $template, array $slots): Rendered
    {
        $text = '';
        foreach (Ir::maps($template, 'parts') as $part) {
            if (Ir::string($part, 'kind') === 'text') {
                $text .= Ir::string($part, 'text') ?? '';
                continue;
            }
            $value = self::slot($part, $slots);
            if (!$value->present || !is_scalar($value->value)) {
                return Rendered::missing();
            }
            $text .= (string) $value->value;
        }

        return Rendered::of($text);
    }

    /** @param array<string, mixed> $slots */
    private static function slot(mixed $template, array $slots): Rendered
    {
        $name = Ir::string($template, 'slot') ?? '';
        if (!array_key_exists($name, $slots)) {
            return Rendered::missing();
        }

        $value = $slots[$name];
        foreach (Ir::strings($template, 'path') as $key) {
            if ($value instanceof \stdClass && property_exists($value, $key)) {
                $value = $value->{$key};
            } elseif (is_array($value) && array_key_exists($key, $value)) {
                $value = $value[$key];
            } else {
                return Rendered::missing();
            }
        }

        return $value === null ? Rendered::missing() : Rendered::of($value);
    }
}
