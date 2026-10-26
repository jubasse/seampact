<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * The member's presence and JSON type, read on the objects-preserved input with `array_key_exists`, so an explicit
 * null and an absent key never look alike, `{}` is never a list and a string is never a number. An integer accepts a
 * whole float up to 2^53 in magnitude (`1.0`); a larger one, which the decode may have changed, is refused as
 * `maximum`, or `minimum` below zero.
 */
final class TypeRule extends ContractRule
{
    public const STRING = 'string';
    public const INTEGER = 'integer';
    public const NUMBER = 'number';
    public const BOOLEAN = 'boolean';
    public const OBJECT = 'object';
    public const ARRAY = 'array';

    private const LARGEST_EXACT_FLOAT_INTEGER = 9007199254740992.0;

    public function __construct(
        InputTree $input,
        Position $position,
        private readonly string $type,
        private readonly Presence $presence,
        private readonly Nullability $nullability,
    ) {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->input->lookup($attribute, $this->position);

        if ($found->isAbsent()) {
            if ($this->presence === Presence::Required) {
                $this->failWith($attribute, 'required', $fail);
            }

            return;
        }

        if (!$found->isPresent()) {
            return;
        }

        if ($found->value === null) {
            if ($this->nullability === Nullability::NotNull) {
                $this->failWith($attribute, 'type', $fail);
            }

            return;
        }

        $issue = $this->typeIssue($found->value);
        if ($issue !== null) {
            $this->failWith($attribute, $issue, $fail);
        }
    }

    private function typeIssue(mixed $value): ?string
    {
        $matches = match ($this->type) {
            self::STRING => is_string($value),
            self::INTEGER => is_int($value) || is_float($value),
            self::NUMBER => is_int($value) || is_float($value),
            self::BOOLEAN => is_bool($value),
            self::OBJECT => $value instanceof \stdClass,
            self::ARRAY => is_array($value) && array_is_list($value),
            default => throw new \LogicException("The generated type rule names the unknown type '{$this->type}'."),
        };

        if (!$matches) {
            return 'type';
        }

        return $this->type === self::INTEGER && is_float($value) ? self::wholeFloatIssue($value) : null;
    }

    // A JSON integer that fits an `int` decodes to an `int`; a float here is `1.0` or a number beyond that range.
    private static function wholeFloatIssue(float $value): ?string
    {
        if (!is_finite($value) || floor($value) !== $value) {
            return 'type';
        }

        if (abs($value) > self::LARGEST_EXACT_FLOAT_INTEGER) {
            return $value < 0 ? 'minimum' : 'maximum';
        }

        return null;
    }
}
