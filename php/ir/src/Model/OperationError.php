<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A code the operation can answer, declared or derived. */
final readonly class OperationError
{
    /**
     * @param string $code
     * @param IrOpaque|null $example
     * @param DerivedFrom|null $derivedFrom
     * @param Origin|null $origin
     */
    public function __construct(
        public string $code,
        public ?IrOpaque $example = null,
        public ?DerivedFrom $derivedFrom = null,
        public ?Origin $origin = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationError');

        return new self(
            code: IrHydration::string(IrHydration::required($members, 'code', 'OperationError'), 'OperationError.code'),
            example: IrHydration::optionalOpaque($members, 'example'),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'code'} = $this->code;
        if ($this->example !== null) {
            $json->{'example'} = IrHydration::copy($this->example->value);
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        return $json;
    }
}
