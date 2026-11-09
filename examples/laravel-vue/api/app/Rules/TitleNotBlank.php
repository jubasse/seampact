<?php

declare(strict_types=1);

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/** A title of only spaces passes the contract's `minLength: 1`; the class name gives the wire rule `app.titleNotBlank`. */
final class TitleNotBlank implements ValidationRule
{
    // Laravel skips a rule on a blank string unless the rule is implicit; this one exists for exactly that value.
    public bool $implicit = true;

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (is_string($value) && trim($value) === '') {
            $fail('The title must not be blank.');
        }
    }
}
