<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/** A list member's item count (`rules: seampact-consistent`). */
final class ItemCountRule extends ContractRule
{
    public function __construct(InputTree $input, Position $position, private readonly ?int $minItems = null, private readonly ?int $maxItems = null)
    {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);

        if (!is_array($found->value)) {
            return;
        }

        $count = count($found->value);
        if ($this->minItems !== null && $count < $this->minItems) {
            $this->failWith($attribute, 'minItems', $fail);
        } elseif ($this->maxItems !== null && $count > $this->maxItems) {
            $this->failWith($attribute, 'maxItems', $fail);
        }
    }
}
