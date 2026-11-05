<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\ContractIR;

/**
 * What a PHP target adds to `Generator`: the forms of one api of `$entry` the generated boundary leaves to the
 * handler, each a warning `vendor/bin/seampact` prints once the api generates (ADR 0016 "Left to the handler"). It is a
 * second interface so that a target built before it is refused by name, never a PHP fatal error at load.
 */
interface HandlerWarningGenerator
{
    /** @return list<ConfigProblem> */
    public function handlerWarnings(ContractIR $ir, TargetEntry $entry): array;
}
