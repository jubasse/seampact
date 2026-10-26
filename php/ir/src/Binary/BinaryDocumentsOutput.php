<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * A documents run that exited with 0: the lines the binary printed on standard output and its warnings on standard
 * error, with control characters other than newline and tab removed. Exits 1 and 2 are refused
 * (`binary.documents-refused`), never returned.
 */
final readonly class BinaryDocumentsOutput
{
    public function __construct(public string $stdout, public string $stderr)
    {
    }
}
