<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Support;

use Seampact\Symfony\Runtime\InputConstraint;
use Seampact\Symfony\Runtime\InputShape;

/** An input constraint whose shape the test sets, as a generated operation constraint fixes its own. */
final class ShapeConstraint extends InputConstraint
{
    public static ?InputShape $shape = null;
}
