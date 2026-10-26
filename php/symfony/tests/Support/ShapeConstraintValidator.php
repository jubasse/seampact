<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Symfony\Runtime\InputConstraintValidator;
use Seampact\Symfony\Runtime\InputShape;

final class ShapeConstraintValidator extends InputConstraintValidator
{
    protected function shape(): InputShape
    {
        return ShapeConstraint::$shape ?? throw new \LogicException('The test set no input shape.');
    }
}
