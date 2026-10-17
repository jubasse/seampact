<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Deprecation
{
    /**
     * @param string $sunset
     * @param Origin $origin
     * @param OperationRef|null $successor
     */
    public function __construct(
        public string $sunset,
        public Origin $origin,
        public ?OperationRef $successor = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Deprecation');

        return new self(
            sunset: IrHydration::string(IrHydration::required($members, 'sunset', 'Deprecation'), 'Deprecation.sunset'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Deprecation')),
            successor: IrHydration::optional($members, 'successor', static fn (mixed $item): OperationRef => OperationRef::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'sunset'} = $this->sunset;
        if ($this->successor !== null) {
            $json->{'successor'} = $this->successor->toJson();
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
