<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ResponseHeader
{
    /**
     * @param string $name
     * @param TypeUse $type
     * @param bool $required
     * @param ResponseHeaderSemantic|null $semantic
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $name,
        public TypeUse $type,
        public bool $required,
        public ?ResponseHeaderSemantic $semantic = null,
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
            semantic: IrHydration::optional($members, 'semantic', static fn (mixed $item): ResponseHeaderSemantic => ResponseHeaderSemantic::fromJson($item)),
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
            $json->{'semantic'} = $this->semantic->toJson();
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
