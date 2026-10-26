<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

/** An object member refuses every key its schema does not declare, each reported at its own pointer. */
final class UnknownKeysRule extends ContractRule
{
    /** @param list<string> $declaredKeys the declared wire names */
    public function __construct(InputTree $input, Position $position, private readonly array $declaredKeys)
    {
        parent::__construct($input, $position);
    }

    public function validate(string $attribute, mixed $value, \Closure $fail): void
    {
        $found = $this->presentValue($attribute);

        if (!$found->value instanceof \stdClass) {
            return;
        }

        foreach (array_keys(get_object_vars($found->value)) as $key) {
            if (!in_array((string) $key, $this->declaredKeys, true)) {
                $this->input->record($attribute . '.' . InputTree::escape((string) $key), 'unknownKeys');
                $fail('unknownKeys');
            }
        }
    }
}
