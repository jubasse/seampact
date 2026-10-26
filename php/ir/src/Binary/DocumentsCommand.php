<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The binary's commands on an app config's OpenAPI documents (ADR 0010 "The standalone compiler binary"):
 * `generate`, `generate --force`, which overwrites a document edited by hand, and `check`.
 */
enum DocumentsCommand
{
    case Generate;
    case GenerateOverwritingHandEdits;
    case Check;

    /** @return list<string> */
    public function arguments(): array
    {
        return match ($this) {
            self::Generate => ['generate'],
            self::GenerateOverwritingHandEdits => ['generate', '--force'],
            self::Check => ['check'],
        };
    }
}
