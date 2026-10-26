<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony\Runtime;

/**
 * A member's JSON type, checked on the objects-preserved decoding without coercion: `{}` is never a list and a string
 * is never a number. An integer accepts a whole float up to 2^53 in magnitude (`1.0`); a larger one, which the decode
 * may have changed, is refused as `maximum`, or `minimum` below zero. A JSON integer that fits an `int` decodes to an
 * `int`, so a float here is `1.0` or a number beyond that range.
 */
enum JsonType
{
    case String;
    case Integer;
    case Number;
    case Boolean;
    case Object;
    case List;

    private const LARGEST_EXACT_FLOAT_INTEGER = 9007199254740992.0;

    /** The contract rule `$value` breaks, or null when it has this type; never called with null. */
    public function issueOf(mixed $value): ?string
    {
        $matches = match ($this) {
            self::String => is_string($value),
            self::Integer, self::Number => is_int($value) || is_float($value),
            self::Boolean => is_bool($value),
            self::Object => $value instanceof \stdClass,
            self::List => is_array($value) && array_is_list($value),
        };

        if (!$matches) {
            return Rule::TYPE;
        }

        return $this === self::Integer && is_float($value) ? self::wholeFloatIssue($value) : null;
    }

    private static function wholeFloatIssue(float $value): ?string
    {
        if (!is_finite($value) || floor($value) !== $value) {
            return Rule::TYPE;
        }

        if (abs($value) > self::LARGEST_EXACT_FLOAT_INTEGER) {
            return $value < 0 ? Rule::MINIMUM : Rule::MAXIMUM;
        }

        return null;
    }
}
