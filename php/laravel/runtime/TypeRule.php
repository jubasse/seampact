<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/**
 * The member's presence and JSON type, read on the objects-preserved input with `array_key_exists`, so an explicit
 * null and an absent key never look alike, `{}` is never a list and a string is never a number. An integer accepts a
 * whole number in the safe range of ADR 0003, up to 2^53 - 1 in magnitude, as an `int` or a whole float (`1.0`); a
 * larger one is refused as `maximum`, or `minimum` below zero, as on the Node targets. A number the decode made infinite (`1e400`) is a `type` issue, as on the Node
 * targets, which take only finite numbers.
 */
final class TypeRule extends ContractRule
{
    public const STRING = 'string';
    public const INTEGER = 'integer';
    public const NUMBER = 'number';
    public const BOOLEAN = 'boolean';
    public const OBJECT = 'object';
    public const ARRAY = 'array';
    // An opaque value: any JSON value whose numbers are finite, since an infinite one cannot be written back.
    public const ANY = 'any';

    // ADR 0003 keeps a plain integer in the safe range of a double, as the Node targets check it.
    private const LARGEST_SAFE_INTEGER = 9007199254740991;

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
            self::ANY => self::finiteThroughout($value),
            default => throw new \LogicException("The generated type rule names the unknown type '{$this->type}'."),
        };

        if (!$matches) {
            return 'type';
        }

        if (is_int($value)) {
            return $this->type === self::INTEGER ? self::boundIssue($value) : null;
        }

        if (!is_float($value)) {
            return null;
        }

        return match ($this->type) {
            self::INTEGER => self::wholeFloatIssue($value),
            self::NUMBER => is_finite($value) ? null : 'type',
            default => null,
        };
    }

    // A JSON integer that fits an `int` decodes to an `int`; a float here is `1.0` or a number beyond that range.
    private static function finiteThroughout(mixed $value): bool
    {
        if (is_float($value)) {
            return is_finite($value);
        }
        if (!is_array($value) && !$value instanceof \stdClass) {
            return true;
        }
        foreach ((array) $value as $member) {
            if (!self::finiteThroughout($member)) {
                return false;
            }
        }

        return true;
    }

    private static function wholeFloatIssue(float $value): ?string
    {
        if (!is_finite($value) || floor($value) !== $value) {
            return 'type';
        }

        return self::boundIssue($value);
    }

    private static function boundIssue(int|float $value): ?string
    {
        if (abs($value) > self::LARGEST_SAFE_INTEGER) {
            return $value < 0 ? 'minimum' : 'maximum';
        }

        return null;
    }
}
