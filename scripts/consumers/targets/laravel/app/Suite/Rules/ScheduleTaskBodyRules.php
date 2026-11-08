<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use App\Generated\Tasks\Laravel\InputRules;
use Closure;
use Illuminate\Contracts\Validation\DataAwareRule;
use Illuminate\Contracts\Validation\ValidationRule;

/** The rules of the body of `scheduleTask`. */
final class ScheduleTaskBodyRules implements InputRules
{
    public const UNNAMED_NOTE = 'unnamed';

    public function operationId(): string
    {
        return 'scheduleTask';
    }

    public function part(): string
    {
        return 'body';
    }

    public function rules(): array
    {
        return [
            'end' => [new EndAfterStart()],
            '' => [new WindowTooLong(), self::unnamedNoteRule()],
        ];
    }

    // An anonymous class has no name: the suite checks that it answers `app.invalid`.
    private static function unnamedNoteRule(): ValidationRule
    {
        return new class implements ValidationRule, DataAwareRule {
            public bool $implicit = true;

            /** @var array<string, mixed> */
            private array $data = [];

            public function validate(string $attribute, mixed $value, Closure $fail): void
            {
                if (($this->data['note'] ?? null) === ScheduleTaskBodyRules::UNNAMED_NOTE) {
                    $fail('The note is refused.');
                }
            }

            /** @param array<string, mixed> $data */
            public function setData(array $data): static
            {
                $this->data = $data;

                return $this;
            }
        };
    }
}
