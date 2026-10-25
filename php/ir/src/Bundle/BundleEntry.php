<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** One regular file of a bundle tarball: its path and bytes. */
final readonly class BundleEntry
{
    public function __construct(public string $path, public string $bytes)
    {
    }
}
