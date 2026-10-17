<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The CSRF check of an unsafe operation reached through a cookie scheme: the derived header, or an exemption with its reason (invariant ir.csrf.cookie). Must act: an unknown tag makes the IR invalid for every reader. */
abstract readonly class Csrf
{
    /** The tag member 'kind': it picks the variant. */
    abstract public function tag(): string;

    abstract public function toJson(): \stdClass;

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Csrf');
        $tag = IrHydration::unionTag($members, 'kind', 'Csrf');

        return match ($tag) {
            'derived' => DerivedCsrf::fromJson($members),
            'exempt' => ExemptCsrf::fromJson($members),
            default => new CsrfUnknown($tag, $members),
        };
    }
}
