<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A template of the template language (ADR 0002 sections 13 and 14). */
abstract readonly class Template
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Template');
        $tag = IrHydration::unionTag($members, 'kind', 'Template');

        return match ($tag) {
            'slot' => SlotTemplate::fromJson($members),
            'text' => TextTemplate::fromJson($members),
            'literal' => LiteralTemplate::fromJson($members),
            'object' => ObjectTemplate::fromJson($members),
            'array' => ArrayTemplate::fromJson($members),
            'each' => EachTemplate::fromJson($members),
            default => new TemplateUnknown($tag, $members),
        };
    }
}
