<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class InputField
{
    /**
     * @param string $name
     * @param FieldWire $wire
     */
    public function __construct(
        public string $name,
        public FieldWire $wire,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'InputField');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'InputField'), 'InputField.name'),
            wire: FieldWire::fromJson(IrHydration::required($members, 'wire', 'InputField')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'wire'} = $this->wire->toJson();
        return $json;
    }
}
