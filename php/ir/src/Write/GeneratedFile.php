<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** One file a target generated: a relative POSIX `path` inside its output root and its text. */
final readonly class GeneratedFile
{
    public function __construct(public string $path, public string $contents)
    {
    }
}
