<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The idempotency key of an unsafe operation: derived settings, or an exemption with its reason. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Idempotency
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Idempotency');
        $tag = IrHydration::unionTag($members, 'kind', 'Idempotency');

        return match ($tag) {
            'derived' => DerivedIdempotency::fromJson($members),
            'exempt' => ExemptIdempotency::fromJson($members),
            default => new IdempotencyUnknown($tag, $members),
        };
    }
}
