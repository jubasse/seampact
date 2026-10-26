<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * A compile that exited with 0: the IR text of each api, read with the `seampact/ir` reader by the caller with
 * its own support, and the binary's diagnostics (warnings), with control characters other than newline and tab
 * removed. Exits 1 and 2 are refused (`binary.compile-refused`), never returned.
 */
final readonly class BinaryCompileOutput
{
    /** @param array<string, string> $irTextByApi */
    public function __construct(public string $diagnostics, public array $irTextByApi)
    {
    }
}
