<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * A number member's bounds and step with the contract's meaning (`rules: seampact-consistent`). ADR 0003 keeps
 * `multipleOf` on integers only, so the step is checked exactly, as Laravel's `multiple_of` and the Spring runtime do.
 */
final class NumberRule extends ContractRule
{
    public function __construct(
        InputTree $input,
        Position $position,
        private readonly int|float|null $minimum = null,
        private readonly int|float|null $maximum = null,
        private readonly int|float|null $exclusiveMinimum = null,
        private readonly int|float|null $exclusiveMaximum = null,
        private readonly ?int $multipleOf = null,
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

    // The type rule let through only whole floats up to 2^53 in magnitude, which convert to an int exactly.
    private static function isMultiple(int|float $number, int $step): bool
    {
        if (is_float($number) && floor($number) !== $number) {
            return false;
        }

        return (int) $number % $step === 0;
    }
}
