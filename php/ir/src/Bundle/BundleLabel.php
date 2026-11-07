<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A name and a version of the manifest: the contract, the compiler or a pack. */
final readonly class BundleLabel
{
    public function __construct(public string $name, public string $version)
    {
    }
}
