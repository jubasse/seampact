<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A resolved convention value with the origin of the node that set it. */
final readonly class ConventionValue
{
    /**
     * @param mixed $value
     * @param Origin $origin
     */
    public function __construct(
        public mixed $value,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ConventionValue');

        return new self(
            value: IrHydration::copy(IrHydration::required($members, 'value', 'ConventionValue')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'ConventionValue')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'value'} = IrHydration::copy($this->value);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
