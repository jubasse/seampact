<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A requirement, in declared order (FR-5). Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Requirement
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Requirement');
        $tag = IrHydration::unionTag($members, 'kind', 'Requirement');

        return match ($tag) {
            'right' => RightRequirement::fromJson($members),
            'rule' => RuleRequirement::fromJson($members),
            default => new RequirementUnknown($tag, $members),
        };
    }
}
