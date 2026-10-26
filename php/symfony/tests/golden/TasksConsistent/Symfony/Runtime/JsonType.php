<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * A member's JSON type, checked on the objects-preserved decoding without coercion: `{}` is never a list and a string
 * is never a number. An integer accepts a whole number in the safe range of ADR 0003, up to 2^53 - 1 in magnitude,
 * whether it decoded to an `int` or a float (`1.0`); a larger one is refused as `maximum`, or `minimum` below zero, as
 * on the Node targets. A number beyond the float range, which decodes to
 * an infinity, is refused as `type`, as on the Node and JVM targets.
 */
enum JsonType
{
    case String;
    case Integer;
    case Number;
    case Boolean;
    case Object;
    case List;

    private const LARGEST_SAFE_INTEGER = 9007199254740991;

    /** The contract rule `$value` breaks, or null when it has this type; never called with null. */
    public function issueOf(mixed $value): ?string
    {
        $matches = match ($this) {
            self::String => is_string($value),
            self::Integer, self::Number => is_int($value) || (is_float($value) && is_finite($value)),
            self::Boolean => is_bool($value),
            self::Object => $value instanceof \stdClass,
            self::List => is_array($value) && array_is_list($value),
        };

        if (!$matches) {
            return Rule::TYPE;
        }

        return $this === self::Integer && (is_int($value) || is_float($value)) ? self::integerIssue($value) : null;
    }

    private static function integerIssue(int|float $value): ?string
    {
        if (is_float($value) && floor($value) !== $value) {
            return Rule::TYPE;
        }

        if (abs($value) > self::LARGEST_SAFE_INTEGER) {
            return $value < 0 ? Rule::MINIMUM : Rule::MAXIMUM;
        }

        return null;
    }
}
