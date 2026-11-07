<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** One regular file of a bundle tarball: its path, and the offset and size of its bytes in the uncompressed archive. */
final readonly class BundleEntry
{
    public function __construct(public string $path, public int $offset, public int $size)
    {
    }
}
