<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An identity (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Identity
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Identity');
        $tag = IrHydration::unionTag($members, 'kind', 'Identity');

        return match ($tag) {
            'credential' => CredentialIdentity::fromJson($members),
            'signed' => SignedIdentity::fromJson($members),
            default => new IdentityUnknown($tag, $members),
        };
    }
}
