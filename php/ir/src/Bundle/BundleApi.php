<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** One api of the manifest: its IR file and the IR version and revision it was written in. */
final readonly class BundleApi
{
    public function __construct(public string $name, public string $file, public int $irVersion, public int $irRevision)
    {
    }
}
