<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ResponseHeader
{
    /**
     * @param string $name
     * @param TypeUse $type
     * @param bool $required
     * @param string|null $semantic
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $name,
        public TypeUse $type,
        public bool $required,
        public ?string $semantic = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ResponseHeader');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'ResponseHeader'), 'ResponseHeader.name'),
            type: TypeUse::fromJson(IrHydration::required($members, 'type', 'ResponseHeader')),
            required: IrHydration::boolean(IrHydration::required($members, 'required', 'ResponseHeader'), 'ResponseHeader.required'),
            semantic: IrHydration::optional($members, 'semantic', static fn (mixed $item): string => IrHydration::string($item, 'ResponseHeader.semantic')),
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
        if ($this->semantic !== null) {
            $json->{'semantic'} = $this->semantic;
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
