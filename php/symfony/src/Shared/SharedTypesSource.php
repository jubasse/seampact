<?php

declare(strict_types=1);

namespace Seampact\Symfony\Shared;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Run\GenerationRefusedException;

/** Builds the shared part of one api's generated code under `$namespace`. */
interface SharedTypesSource
{
    /** @throws GenerationRefusedException a form the shared types refuse, by name */
    public function types(ContractIR $ir, string $namespace, string $entryId): SharedTypes;
}
