<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * What a compile gave: exit 0 with the IR text of each api, read with the `seampact/ir` reader by the caller with
 * its own support; or exit 1 (refused) or 2 (a usage error) with the binary's diagnostics, passed through with
 * control characters other than newline and tab removed.
 */
final readonly class BinaryCompileOutput
{
    /** @param array<string, string> $irTextByApi */
    public function __construct(public int $exitCode, public string $diagnostics, public array $irTextByApi)
    {
    }

    public function compiled(): bool
    {
        return $this->exitCode === 0;
    }
}
