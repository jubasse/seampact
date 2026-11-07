<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** What a property, item, body or parameter is (ADR 0004 section 5). */
abstract readonly class TypeUse
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'TypeUse');
        $tag = IrHydration::unionTag($members, 'kind', 'TypeUse');

        return match ($tag) {
            'ref' => RefTypeUse::fromJson($members),
            'opaque' => OpaqueTypeUse::fromJson($members),
            'file' => FileTypeUse::fromJson($members),
            'enum' => EnumTypeUse::fromJson($members),
            'scalar' => ScalarTypeUse::fromJson($members),
            'array' => ArrayTypeUse::fromJson($members),
            default => new TypeUseUnknown($tag, $members),
        };
    }
}
