<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel\Runtime;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Providers\FoundationServiceProvider;

/**
 * Hides sensitive values from `dump()` and `dd()`: Laravel's dumper copies VarDumper's casters once, when its
 * foundation provider registers, so after the redacting casters are added it is built again to read them.
 */
final class RedactingDumper
{
    private function __construct()
    {
    }

    public static function install(object $app, ApiContract $contract): void
    {
        DumpRedaction::register($contract);

        $foundation = $app instanceof Application ? $app->getProvider(FoundationServiceProvider::class) : null;
        if ($foundation instanceof FoundationServiceProvider) {
            $foundation->registerDumper();
        }
    }
}
