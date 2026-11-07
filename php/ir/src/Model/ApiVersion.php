<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The api version: the path version number, or a label when every surface's pathVersion is 'none'. */
abstract readonly class ApiVersion
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ApiVersion');
        $tag = IrHydration::unionTag($members, 'kind', 'ApiVersion');

        return match ($tag) {
            'path' => PathApiVersion::fromJson($members),
            'label' => LabelApiVersion::fromJson($members),
            default => new ApiVersionUnknown($tag, $members),
        };
    }
}
