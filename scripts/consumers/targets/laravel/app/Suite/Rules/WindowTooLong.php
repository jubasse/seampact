<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;

/** A window of more than 90 days is refused; it runs on the whole body, so its issue points at `""`. */
final class WindowTooLong implements ValidationRule, DataAwareRule
{
    private const MAX_DAYS = 90;

    // An implicit rule runs although the key `''` names no member.
    public bool $implicit = true;

    /** @var array<string, mixed> */
    private array $data = [];

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $start = $this->data['start'] ?? null;
        $end = $this->data['end'] ?? null;
        if (!is_string($start) || !is_string($end)) {
            return;
        }

        $days = (strtotime($end) - strtotime($start)) / 86400;
        if ($days > self::MAX_DAYS) {
            $fail('The window is longer than 90 days.');
        }
    }

    /** @param array<string, mixed> $data */
    public function setData(array $data): static
    {
        $this->data = $data;

        return $this;
    }
}
