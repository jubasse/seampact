<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PathVersion
{
    /**
     * @param PathVersionMode $value
     * @param Origin $origin
     */
    public function __construct(
        public PathVersionMode $value,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PathVersion');

        return new self(
            value: PathVersionMode::fromJson(IrHydration::required($members, 'value', 'PathVersion')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'PathVersion')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'value'} = $this->value->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
