<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A security scheme (ADR 0004 section 4), tagged on its kind. Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Scheme
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Scheme');
        $tag = IrHydration::unionTag($members, 'kind', 'Scheme');

        return match ($tag) {
            'cookie' => CookieScheme::fromJson($members),
            'header' => HeaderScheme::fromJson($members),
            'query' => QueryScheme::fromJson($members),
            'bearer' => BearerScheme::fromJson($members),
            'basic' => BasicScheme::fromJson($members),
            'signature' => SignatureScheme::fromJson($members),
            default => new SchemeUnknown($tag, $members),
        };
    }
}
