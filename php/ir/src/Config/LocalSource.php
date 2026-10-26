<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** A `path` source: a contract workspace on disk, its absolute directory, compiled by the pinned binary. */
final readonly class LocalSource
{
    public function __construct(public string $directory)
    {
    }
}
