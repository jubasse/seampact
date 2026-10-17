<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class NamedTemplate
{
    /**
     * @param string $name
     * @param Template $value
     */
    public function __construct(
        public string $name,
        public Template $value,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'NamedTemplate');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'NamedTemplate'), 'NamedTemplate.name'),
            value: Template::fromJson(IrHydration::required($members, 'value', 'NamedTemplate')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'value'} = $this->value->toJson();
        return $json;
    }
}
