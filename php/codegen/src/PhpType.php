<?php

declare(strict_types=1);

namespace Seampact\Codegen;

/** A PHP type as the generated code declares it: the native type (classes fully qualified) and its PHPDoc form. */
final readonly class PhpType
{
    public function __construct(public string $native, public string $doc, public bool $nullable = false)
    {
    }

    /** Whether the PHPDoc says more than the native type (a generic), so a `@param` line is written for it. */
    public function needsDoc(): bool
    {
        return str_contains($this->doc, '<');
    }
}
