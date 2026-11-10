<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\InputRuleSet;
use Symfony\Component\Validator\Constraint;

/**
 * The app's input rules of one operation and one input part, as Symfony constraints (ADR 0028): the boundary calls
 * `validate($part, $constraints)` on the input's typed part object, which runs only these constraints. A rule's name
 * is the constraint's `payload['rule']`, else the code its violation sets, else a custom constraint's class short
 * name, first letter lowered. A part the request does not carry (an optional body that was not sent) is not checked.
 */
interface InputRules extends InputRuleSet
{
    /** @return Constraint|array<Constraint> the constraints to run on the part, as `ValidatorInterface::validate` takes them */
    public function constraints(): Constraint|array;
}
