<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;
use Seampact\Symfony\Runtime\KeyPolicy;

/**
 * The members of the input of operation 'health', as the contract declares them.
 */
final class HealthInputConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return new InputShape(unknownQuery: KeyPolicy::Refuse);
    }
}
