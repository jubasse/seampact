<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PrincipalRequirement
{
    /**
     * @param string $field
     * @param Origin $origin
     */
    public function __construct(
        public string $field,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PrincipalRequirement');

        return new self(
            field: IrHydration::string(IrHydration::required($members, 'field', 'PrincipalRequirement'), 'PrincipalRequirement.field'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'PrincipalRequirement')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'field'} = $this->field;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
