<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The subject a right is checked against. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class RightSubject
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RightSubject');
        $tag = IrHydration::unionTag($members, 'kind', 'RightSubject');

        return match ($tag) {
            'none' => NoSubject::fromJson($members),
            'scope' => ScopeSubject::fromJson($members),
            'resource' => ResourceSubject::fromJson($members),
            default => new RightSubjectUnknown($tag, $members),
        };
    }
}
