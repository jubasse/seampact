<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony\Runtime;

use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\ConstraintValidator;
use Symfony\Component\Validator\Exception\UnexpectedTypeException;

/** Adds the issue it is given: the generated walk has already decided that the member breaks the rule. */
final class IssueValidator extends ConstraintValidator
{
    public function validate(mixed $value, Constraint $constraint): void
    {
        if (!$constraint instanceof Issue) {
            throw new UnexpectedTypeException($constraint, Issue::class);
        }

        $this->context->buildViolation(Issue::MESSAGE)
            ->setParameter('{{ rule }}', $constraint->rule)
            ->setCode($constraint->rule)
            ->addViolation();
    }
}
