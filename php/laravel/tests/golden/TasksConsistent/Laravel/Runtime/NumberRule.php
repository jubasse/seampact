<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

/** A number member's bounds and step with the contract's meaning (`rules: seampact-consistent`). */
final class NumberRule extends ContractRule
{
    private const STEP_TOLERANCE = 1e-9;

    public function __construct(
        InputTree $input,
        Position $position,
        private readonly int|float|null $minimum = null,
        private readonly int|float|null $maximum = null,
        private readonly int|float|null $exclusiveMinimum = null,
        private readonly int|float|null $exclusiveMaximum = null,
        private readonly int|float|null $multipleOf = null,
    ) {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);
        $number = $found->value;

        if (!is_int($number) && !is_float($number)) {
            return;
        }

        $issue = match (true) {
            $this->minimum !== null && $number < $this->minimum => 'minimum',
            $this->maximum !== null && $number > $this->maximum => 'maximum',
            $this->exclusiveMinimum !== null && $number <= $this->exclusiveMinimum => 'exclusiveMinimum',
            $this->exclusiveMaximum !== null && $number >= $this->exclusiveMaximum => 'exclusiveMaximum',
            $this->multipleOf !== null && !self::isMultiple($number, $this->multipleOf) => 'multipleOf',
            default => null,
        };

        if ($issue !== null) {
            $this->failWith($attribute, $issue, $fail);
        }
    }

    private static function isMultiple(int|float $number, int|float $step): bool
    {
        if (is_int($number) && is_int($step)) {
            return $number % $step === 0;
        }

        $quotient = $number / $step;

        return abs($quotient - round($quotient)) <= self::STEP_TOLERANCE * max(1.0, abs($quotient));
    }
}
