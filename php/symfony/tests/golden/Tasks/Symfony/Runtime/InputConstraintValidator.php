<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

/** The base of each operation's generated input validator: the operation's input shape, walked by `InputWalk`. */
abstract class InputConstraintValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof InputConstraint) {
            throw new UnexpectedTypeException($constraint, InputConstraint::class);
        }

        (new InputWalk($this->context))->input($value, $this->shape());
    }

    abstract protected function shape(): InputShape;
}
