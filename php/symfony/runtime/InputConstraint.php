<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Symfony\Component\Validator\Constraint;

/**
 * The base of each operation's generated input constraint, which the boundary runs through the app's `validator`
 * service on the decoded input; Symfony finds its validator by the `Validator` suffix.
 */
abstract class InputConstraint extends Constraint
{
    public function __construct()
    {
        parent::__construct(null, null, null);
    }
}
