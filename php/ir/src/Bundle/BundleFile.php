<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** One listed file of the manifest: its path, size and lowercase hexadecimal SHA-256. */
final readonly class BundleFile
{
    public function __construct(public string $path, public int $size, public string $sha256)
    {
    }
}
