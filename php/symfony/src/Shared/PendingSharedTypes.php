<?php

declare(strict_types=1);

namespace Seampact\Symfony\Shared;

use Seampact\Ir\Config\ConfigProblem;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Run\GenerationRefusedException;

/**
 * The shared types this release of `seampact/symfony` has: none yet. Every api is refused by name, so `generate`
 * never writes a Symfony placement whose value types, inputs, results and exceptions are missing.
 */
final class PendingSharedTypes implements SharedTypesSource
{
    public const CODE = 'target.types.unsupported';

    public function types(ContractIR $ir, string $namespace, string $entryId): SharedTypes
    {
        throw new GenerationRefusedException([new ConfigProblem(
            self::CODE,
            'seampact/symfony does not generate the value types, inputs, results and exceptions of a contract yet: a later seampact/symfony release brings them, with the PHP emitters it shares with seampact/laravel.',
            'Wait for that release, or remove the seampact/symfony entry from the app config until then.',
            "entry '{$entryId}'",
        )]);
    }
}
