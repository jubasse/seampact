<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

use Seampact\Ir\Config\AppConfig;

/** A run with every entry planned, or refused one by one, before anything is written. */
final readonly class PreparedRun
{
    /**
     * @param list<array{string, string}> $checkedBundles each bundle source that passed the check, with its integrity
     * @param list<EntryPlan> $plans
     */
    public function __construct(public AppConfig $config, public array $checkedBundles, public array $plans)
    {
    }
}
