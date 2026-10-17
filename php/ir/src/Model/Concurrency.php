<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Concurrency
{
    /**
     * @param ValueSource $version
     * @param string $field
     * @param DerivedFrom $derivedFrom
     */
    public function __construct(
        public ValueSource $version,
        public string $field,
        public DerivedFrom $derivedFrom,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Concurrency');

        return new self(
            version: ValueSource::fromJson(IrHydration::required($members, 'version', 'Concurrency')),
            field: IrHydration::string(IrHydration::required($members, 'field', 'Concurrency'), 'Concurrency.field'),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'Concurrency')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'version'} = $this->version->toJson();
        $json->{'field'} = $this->field;
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }
}
