<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The key a signature is verified with: an id the application resolves to its secret, never the secret itself, written as a value or read from the request. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class SchemeKey
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SchemeKey');
        $tag = IrHydration::unionTag($members, 'kind', 'SchemeKey');

        return match ($tag) {
            'value' => ValueSchemeKey::fromJson($members),
            'from' => SourceSchemeKey::fromJson($members),
            default => new SchemeKeyUnknown($tag, $members),
        };
    }
}
