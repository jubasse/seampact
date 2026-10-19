<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Binding
{
    /**
     * @param ValueSource $from
     * @param ValueSource $to
     * @param Origin $origin
     */
    public function __construct(
        public ValueSource $from,
        public ValueSource $to,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Binding');

        return new self(
            from: ValueSource::fromJson(IrHydration::required($members, 'from', 'Binding')),
            to: ValueSource::fromJson(IrHydration::required($members, 'to', 'Binding')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Binding')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'from'} = $this->from->toJson();
        $json->{'to'} = $this->to->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
