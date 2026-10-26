<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The base of the generated rule objects: each reads its value in the input tree, never in Laravel's validation
 * data, and is implicit, so Laravel also runs it on an absent member and on an empty or whitespace-only string.
 */
abstract class ContractRule implements ValidationRule
{
    public bool $implicit = true;

    public function __construct(protected readonly InputTree $input, protected readonly Position $position)
    {
    }

    /** The value at `$attribute`, or null when it is absent, null or not reachable: the type rule judges those. */
    protected function presentValue(string $attribute): Lookup
    {
        $found = $this->input->lookup($attribute, $this->position);

        if (!$found->isPresent() || $found->value === null) {
            return Lookup::unreachable();
        }

        return $found;
    }

    /** Records the issue in the input tree and fails the attribute in Laravel's validator. */
    protected function failWith(string $attribute, string $contractRule, \Closure $fail): void
    {
        $this->input->record($attribute, $contractRule);
        $fail($contractRule);
    }
}
