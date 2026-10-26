<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Symfony;

use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputConstraintValidator;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\InputShape;
use Seampact\Golden\TasksConsistent\Symfony\Runtime\KeyPolicy;

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
