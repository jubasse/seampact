<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\AppConfig;
use Seampact\Ir\Config\ConfigProblem;

/** A run with every entry planned, or refused one by one, before anything is written; the documents run after it. */
final readonly class PreparedRun
{
    /**
     * @param ContractApis $contractApis the sources it read, the bundles that passed the check and the binary
     * @param list<EntryPlan> $plans
     * @param list<ConfigProblem> $warnings the compatibility check's, which generate and check print
     */
    public function __construct(public AppConfig $config, public ContractApis $contractApis, public array $plans, public array $warnings)
    {
    }
}
