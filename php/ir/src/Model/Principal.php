<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The principal schema: one schema, or one per credential variant. */
abstract readonly class Principal
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Principal');
        $tag = IrHydration::unionTag($members, 'kind', 'Principal');

        return match ($tag) {
            'schema' => SchemaPrincipal::fromJson($members),
            'variants' => VariantsPrincipal::fromJson($members),
            default => new PrincipalUnknown($tag, $members),
        };
    }
}
