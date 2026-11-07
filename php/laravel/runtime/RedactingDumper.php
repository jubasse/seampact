<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Providers\FoundationServiceProvider;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\DumpRedaction;
use Symfony\Component\VarDumper\VarDumper;

/**
 * Hides sensitive values from `dump()` and `dd()`: Laravel's dumper copies VarDumper's casters once, when its
 * foundation provider registers, so after the redacting casters are added it is built again to read them. A handler
 * another package installed earlier (Telescope, a dump server) is kept as it is: only Laravel's own is rebuilt.
 */
final class RedactingDumper
{
    private const LARAVEL_DUMPERS = '/Illuminate/Foundation/';

    private function __construct()
    {
    }

    public static function install(object $app, ApiContract $contract): void
    {
        DumpRedaction::register($contract);

        $foundation = $app instanceof Application ? $app->getProvider(FoundationServiceProvider::class) : null;
        if (!$foundation instanceof FoundationServiceProvider || !self::isLaravels(self::currentHandler())) {
            return;
        }

        $foundation->registerDumper();
    }

    private static function currentHandler(): ?callable
    {
        $current = VarDumper::setHandler(null);
        VarDumper::setHandler($current);

        return $current;
    }

    // Laravel's handler is a closure its CLI or HTML dumper registered; any other handler belongs to the app.
    private static function isLaravels(?callable $handler): bool
    {
        if (!$handler instanceof \Closure) {
            return false;
        }
        $file = (new \ReflectionFunction($handler))->getFileName();

        return is_string($file) && str_contains(str_replace('\\', '/', $file), self::LARAVEL_DUMPERS);
    }
}
