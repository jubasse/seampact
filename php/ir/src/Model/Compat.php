<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Compat
{
    /**
     * @param CompatPolicy $policy
     */
    public function __construct(
        public CompatPolicy $policy,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Compat');

        return new self(
            policy: CompatPolicy::fromJson(IrHydration::required($members, 'policy', 'Compat')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'policy'} = $this->policy->toJson();
        return $json;
    }
}
