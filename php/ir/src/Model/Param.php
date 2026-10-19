<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A path, query or header parameter, declared (origin) or derived (derivedFrom). */
final readonly class Param
{
    /**
     * @param string $name
     * @param TypeUse $type
     * @param bool $required
     * @param QueryWire|null $wire
     * @param IrOpaque|null $default
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $name,
        public TypeUse $type,
        public bool $required,
        public ?QueryWire $wire = null,
        public ?IrOpaque $default = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Param');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'Param'), 'Param.name'),
            type: TypeUse::fromJson(IrHydration::required($members, 'type', 'Param')),
            required: IrHydration::boolean(IrHydration::required($members, 'required', 'Param'), 'Param.required'),
            wire: IrHydration::optional($members, 'wire', static fn (mixed $item): QueryWire => QueryWire::fromJson($item)),
            default: IrHydration::optionalOpaque($members, 'default'),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'type'} = $this->type->toJson();
        $json->{'required'} = $this->required;
        if ($this->wire !== null) {
            $json->{'wire'} = $this->wire->toJson();
        }
        if ($this->default !== null) {
            $json->{'default'} = IrHydration::copy($this->default->value());
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        return $json;
    }
}
