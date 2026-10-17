<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Who may call the operation. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Access
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Access');
        $tag = IrHydration::unionTag($members, 'kind', 'Access');

        return match ($tag) {
            'identity' => IdentityAccess::fromJson($members),
            'optional' => OptionalAccess::fromJson($members),
            'public' => PublicAccess::fromJson($members),
            default => new AccessUnknown($tag, $members),
        };
    }
}
