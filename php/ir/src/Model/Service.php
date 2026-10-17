<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An upstream service (ADR 0004 section 4). */
final readonly class Service
{
    /**
     * @param string $id
     * @param Maturity $maturity
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public Maturity $maturity,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Service');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Service'), 'Service.id'),
            maturity: Maturity::fromJson(IrHydration::required($members, 'maturity', 'Service')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Service')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'maturity'} = $this->maturity->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
