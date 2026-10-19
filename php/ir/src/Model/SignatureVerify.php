<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** How a signature is verified (ADR 0004 section 4). Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class SignatureVerify
{
    /** The tag member 'verify': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SignatureVerify');
        $tag = IrHydration::unionTag($members, 'verify', 'SignatureVerify');

        return match ($tag) {
            'template' => TemplateSignature::fromJson($members),
            'application' => ApplicationSignature::fromJson($members),
            default => new SignatureVerifyUnknown($tag, $members),
        };
    }
}
