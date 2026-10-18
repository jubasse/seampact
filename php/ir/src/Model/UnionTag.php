<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where a union's tag is read; 'header' only for a route's whole input. */
abstract readonly class UnionTag
{
    /** The tag member 'in': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'UnionTag');
        $tag = IrHydration::unionTag($members, 'in', 'UnionTag');

        return match ($tag) {
            'body' => BodyUnionTag::fromJson($members),
            'header' => HeaderUnionTag::fromJson($members),
            default => new UnionTagUnknown($tag, $members),
        };
    }
}
