<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A part of a text template: literal text, or a slot with its path. */
abstract readonly class TextPart
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'TextPart');
        $tag = IrHydration::unionTag($members, 'kind', 'TextPart');

        return match ($tag) {
            'text' => PlainTextPart::fromJson($members),
            'slot' => SlotTextPart::fromJson($members),
            default => new TextPartUnknown($tag, $members),
        };
    }
}
