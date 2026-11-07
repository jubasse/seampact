<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

/** What the binary's documents run printed: its lines, and its warnings without their `warning: ` prefix. */
final readonly class DocumentsRun
{
    /**
     * @param list<string> $lines
     * @param list<string> $warnings
     */
    public function __construct(public array $lines, public array $warnings)
    {
    }
}
