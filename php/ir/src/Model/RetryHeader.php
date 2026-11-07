<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The retry header of a 429 from a bucket rule (grammar 13, rateLimit). */
final readonly class RetryHeader
{
    /**
     * @param string $name
     * @param string $param The required member of the code's params holding the delay in integer milliseconds.
     * @param RetryUnit $unit
     * @param DerivedFrom $derivedFrom
     */
    public function __construct(
        public string $name,
        public string $param,
        public RetryUnit $unit,
        public DerivedFrom $derivedFrom,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RetryHeader');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'RetryHeader'), 'RetryHeader.name'),
            param: IrHydration::string(IrHydration::required($members, 'param', 'RetryHeader'), 'RetryHeader.param'),
            unit: RetryUnit::fromJson(IrHydration::required($members, 'unit', 'RetryHeader')),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'RetryHeader')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'param'} = $this->param;
        $json->{'unit'} = $this->unit->toJson();
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }
}
