<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/**
 * An optional opaque member that is present. An absent member is null instead, so that a JSON null value
 * (new IrOpaque(null)) stays apart from an absent member.
 */
final readonly class IrOpaque
{
    private mixed $value;

    public function __construct(mixed $value)
    {
        $this->value = IrHydration::copy($value);
    }

    /** A copy: the kept value cannot be changed through it. */
    public function value(): mixed
    {
        return IrHydration::copy($this->value);
    }
}
