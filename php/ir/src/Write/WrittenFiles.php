<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** The paths a committed write wrote, left unchanged and removed. */
final readonly class WrittenFiles
{
    /**
     * @param list<string> $written
     * @param list<string> $unchanged
     * @param list<string> $removed
     */
    public function __construct(public array $written, public array $unchanged, public array $removed)
    {
    }
}
