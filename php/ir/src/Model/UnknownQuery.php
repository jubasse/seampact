<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Undeclared query keys. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class UnknownQuery
{
    /** The tag member 'policy': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'UnknownQuery');
        $tag = IrHydration::unionTag($members, 'policy', 'UnknownQuery');

        return match ($tag) {
            'refuse' => RefuseUnknownQuery::fromJson($members),
            'ignore' => IgnoreUnknownQuery::fromJson($members),
            default => new UnknownQueryUnknown($tag, $members),
        };
    }
}
