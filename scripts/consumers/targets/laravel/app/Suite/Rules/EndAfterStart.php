<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;
use Seampact\ConsumerSuite\SuiteControl;

/** The end of a window comes after its start; the class name gives the wire rule `app.endAfterStart`. */
final class EndAfterStart implements ValidationRule, DataAwareRule
{
    /** @var array<string, mixed> */
    private array $data = [];

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        SuiteControl::recordHookCall('input-rule:endAfterStart', 'tasks', 'scheduleTask');
        SuiteControl::throwScriptedHookFailure('input-rule:endAfterStart');

        $start = $this->data['start'] ?? null;
        if (is_string($value) && is_string($start) && $value <= $start) {
            $fail('The end must come after the start.');
        }
    }

    /** @param array<string, mixed> $data */
    public function setData(array $data): static
    {
        $this->data = $data;

        return $this;
    }
}
