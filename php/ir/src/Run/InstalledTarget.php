<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

/** A target package found in `vendor/composer/installed.json`: its name, its version and its generator. */
final readonly class InstalledTarget
{
    public function __construct(public string $package, public string $version, public Generator $generator)
    {
    }
}
