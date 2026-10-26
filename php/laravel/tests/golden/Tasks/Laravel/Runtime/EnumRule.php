<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Laravel\Runtime;

/** A string member holds one of its listed values, compared exactly (Laravel's `in` compares loosely). */
final class EnumRule extends ContractRule
{
    /** @param list<string> $values */
    public function __construct(InputTree $input, Position $position, private readonly array $values)
    {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);

        if (is_string($found->value) && !in_array($found->value, $this->values, true)) {
            $this->failWith($attribute, 'enum', $fail);
        }
    }
}
