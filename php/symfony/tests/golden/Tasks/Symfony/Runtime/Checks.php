<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

/**
 * The value checks the target generates with ADR 0003's meaning, run only once the member has its type: every value
 * rule under `rules: seampact-consistent`; under `native`, the enums, the formats Symfony lacks, and the pattern or
 * format check of the empty string, which Symfony's own constraints pass unchecked. Lengths count code points.
 */
final readonly class Checks
{
    /** @param list<string>|null $enumValues */
    public function __construct(
        public ?array $enumValues = null,
        public ?int $minLength = null,
        public ?int $maxLength = null,
        public ?string $pattern = null,
        public ?Format $format = null,
        public PatternScope $patternScope = PatternScope::EveryString,
        public PatternScope $formatScope = PatternScope::EveryString,
        public int|float|null $minimum = null,
        public int|float|null $maximum = null,
        public int|float|null $exclusiveMinimum = null,
        public int|float|null $exclusiveMaximum = null,
        public ?int $multipleOf = null,
        public ?int $minItems = null,
        public ?int $maxItems = null,
    ) {
    }

    /** @return list<string> the contract rules `$value` breaks, a value that has the member's type */
    public function issuesOf(mixed $value): array
    {
        return match (true) {
            is_string($value) => $this->stringIssues($value),
            is_int($value), is_float($value) => $this->numberIssues($value),
            is_array($value) => $this->listIssues(count($value)),
            default => [],
        };
    }

    /** @return list<string> */
    private function stringIssues(string $value): array
    {
        $issues = [];
        if ($this->enumValues !== null && !in_array($value, $this->enumValues, true)) {
            $issues[] = Rule::ENUM;
        }

        $length = mb_strlen($value, 'UTF-8');
        if ($this->minLength !== null && $length < $this->minLength) {
            $issues[] = Rule::MIN_LENGTH;
        }
        if ($this->maxLength !== null && $length > $this->maxLength) {
            $issues[] = Rule::MAX_LENGTH;
        }

        if ($this->pattern !== null && self::reads($this->patternScope, $value) && !self::matches($this->pattern, $value)) {
            $issues[] = Rule::PATTERN;
        }
        if ($this->format !== null && self::reads($this->formatScope, $value) && !$this->format->accepts($value)) {
            $issues[] = Rule::FORMAT;
        }

        return $issues;
    }

    /** @return list<string> */
    private function numberIssues(int|float $value): array
    {
        $issues = [];
        if ($this->minimum !== null && $value < $this->minimum) {
            $issues[] = Rule::MINIMUM;
        }
        if ($this->maximum !== null && $value > $this->maximum) {
            $issues[] = Rule::MAXIMUM;
        }
        if ($this->exclusiveMinimum !== null && $value <= $this->exclusiveMinimum) {
            $issues[] = Rule::EXCLUSIVE_MINIMUM;
        }
        if ($this->exclusiveMaximum !== null && $value >= $this->exclusiveMaximum) {
            $issues[] = Rule::EXCLUSIVE_MAXIMUM;
        }
        if ($this->multipleOf !== null && !self::isMultiple($value, $this->multipleOf)) {
            $issues[] = Rule::MULTIPLE_OF;
        }

        return $issues;
    }

    /** @return list<string> */
    private function listIssues(int $count): array
    {
        $issues = [];
        if ($this->minItems !== null && $count < $this->minItems) {
            $issues[] = Rule::MIN_ITEMS;
        }
        if ($this->maxItems !== null && $count > $this->maxItems) {
            $issues[] = Rule::MAX_ITEMS;
        }

        return $issues;
    }

    private static function reads(PatternScope $scope, string $value): bool
    {
        return $scope === PatternScope::EveryString || $value === '';
    }

    private static function matches(string $pattern, string $value): bool
    {
        $found = preg_match($pattern, $value);
        if ($found === false) {
            throw new \RuntimeException("The generated pattern {$pattern} failed to run: " . preg_last_error_msg() . '; regenerate the code.');
        }

        return $found === 1;
    }

    // The step is the exact integer step of an integer member, whose value is an `int` or a whole float up to 2^53.
    private static function isMultiple(int|float $value, int $multipleOf): bool
    {
        return is_int($value) ? $value % $multipleOf === 0 : fmod($value, $multipleOf) === 0.0;
    }
}
