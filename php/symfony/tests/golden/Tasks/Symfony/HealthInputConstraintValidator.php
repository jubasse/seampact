<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks\Symfony;

use Seampact\Golden\Tasks\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\Tasks\Symfony\Runtime\InputShape;
use Seampact\Golden\Tasks\Symfony\Runtime\KeyPolicy;

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
