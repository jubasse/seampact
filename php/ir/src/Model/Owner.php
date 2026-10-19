<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Owner
{
    /**
     * @param OwnerKind $kind
     * @param Origin $origin
     */
    public function __construct(
        public OwnerKind $kind,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Owner');

        return new self(
            kind: OwnerKind::fromJson(IrHydration::required($members, 'kind', 'Owner')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Owner')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
