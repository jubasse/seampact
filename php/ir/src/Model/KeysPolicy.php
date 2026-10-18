<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Unknown keys of a signed identity's payload: ignored or kept, with the reason. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class KeysPolicy
{
    /** The tag member 'policy': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'KeysPolicy');
        $tag = IrHydration::unionTag($members, 'policy', 'KeysPolicy');

        return match ($tag) {
            'ignore' => IgnoreKeysPolicy::fromJson($members),
            'keep' => KeepKeysPolicy::fromJson($members),
            default => new KeysPolicyUnknown($tag, $members),
        };
    }
}
