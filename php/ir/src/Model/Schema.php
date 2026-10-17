<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A named schema: objects, maps and unions are always named (ADR 0004 section 5). */
abstract readonly class Schema
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Schema');
        $tag = IrHydration::unionTag($members, 'kind', 'Schema');

        return match ($tag) {
            'object' => ObjectSchema::fromJson($members),
            'map' => MapSchema::fromJson($members),
            'union' => UnionSchema::fromJson($members),
            default => new SchemaUnknown($tag, $members),
        };
    }
}
