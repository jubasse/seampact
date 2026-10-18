<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The name of an object template member: literal text, or a slot. */
abstract readonly class MemberName
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'MemberName');
        $tag = IrHydration::unionTag($members, 'kind', 'MemberName');

        return match ($tag) {
            'text' => PlainMemberName::fromJson($members),
            'slot' => SlotMemberName::fromJson($members),
            default => new MemberNameUnknown($tag, $members),
        };
    }
}
