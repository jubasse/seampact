<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/**
 * A string member's length, counted in code points, and its pattern, a PCRE rendering of the contract's normalised
 * pattern searched anywhere in the value. Under `rules: native` it checks only the empty and whitespace-only strings,
 * which Laravel's `min`, `max` and `regex` skip.
 */
final class StringRule extends ContractRule
{
    public function __construct(
        InputTree $input,
        Position $position,
        private readonly BlankStrings $checked,
        private readonly ?int $minLength = null,
        private readonly ?int $maxLength = null,
        private readonly ?string $pattern = null,
    ) {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);

        if (!is_string($found->value)) {
            return;
        }

        $text = $found->value;
        if ($this->checked === BlankStrings::BlankOnly && trim($text) !== '') {
            return;
        }

        $length = mb_strlen($text, 'UTF-8');
        if ($this->minLength !== null && $length < $this->minLength) {
            $this->failWith($attribute, 'minLength', $fail);
        } elseif ($this->maxLength !== null && $length > $this->maxLength) {
            $this->failWith($attribute, 'maxLength', $fail);
        } elseif ($this->pattern !== null && !$this->matchesPattern($text)) {
            $this->failWith($attribute, 'pattern', $fail);
        }
    }

    private function matchesPattern(string $text): bool
    {
        $matched = preg_match((string) $this->pattern, $text);

        if ($matched === false) {
            throw new \RuntimeException("The generated pattern {$this->pattern} failed to run: " . preg_last_error_msg() . '.');
        }

        return $matched === 1;
    }
}
