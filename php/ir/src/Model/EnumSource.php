<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where an enum's values come from: a shared vocabulary or another enum. */
abstract readonly class EnumSource
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'EnumSource');
        $tag = IrHydration::unionTag($members, 'kind', 'EnumSource');

        return match ($tag) {
            'vocabulary' => VocabularyEnumSource::fromJson($members),
            'enum' => CatalogueEnumSource::fromJson($members),
            default => new EnumSourceUnknown($tag, $members),
        };
    }
}
