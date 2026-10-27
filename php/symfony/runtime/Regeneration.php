<?php

declare(strict_types=1);

namespace Seampact\Symfony\Runtime;

use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\RuntimeVersion;
use Symfony\Component\Console\Input\ArgvInput;
use Symfony\Component\DependencyInjection\ContainerBuilder;

/**
 * The run of `bin/console seampact:generate`, which serves no request: an api generated for another runtime version
 * skips its boot steps there, so the command that fixes the mismatch can run. Every other boot refuses it.
 */
final class Regeneration
{
    public const COMMAND = 'seampact:generate';

    private function __construct()
    {
    }

    public static function skips(string $contractClass): bool
    {
        return (new ArgvInput())->getFirstArgument() === self::COMMAND && !ApiContract::servesInstalledRuntime($contractClass);
    }

    /** A container compiled without the boot check is rebuilt in debug once the contract or the runtime changes. */
    public static function trackVersions(ContainerBuilder $container, string $contractClass): void
    {
        foreach ([$contractClass, RuntimeVersion::class] as $className) {
            // A contract class that does not load leaves nothing to track; every other boot refuses it.
            if (!class_exists($className)) {
                continue;
            }

            $file = (new \ReflectionClass($className))->getFileName();
            if ($file !== false) {
                $container->fileExists($file);
            }
        }
    }
}
