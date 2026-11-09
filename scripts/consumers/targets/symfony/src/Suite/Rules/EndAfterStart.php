<?php

declare(strict_types=1);

namespace App\Suite\Rules;

use Symfony\Component\Validator\Constraint;

/** The end of a window comes after its start; the class name gives the wire rule `app.endAfterStart`. */
final class EndAfterStart extends Constraint
{
    public function getTargets(): string
    {
        return self::CLASS_CONSTRAINT;
    }
}
