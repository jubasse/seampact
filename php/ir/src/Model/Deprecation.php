<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Deprecation
{
    /**
     * @param string $since The day the operation is deprecated, a calendar date, the Deprecation header's date (RFC 9745).
     * @param string $sunset
     * @param Origin $origin
     * @param OperationRef|null $successor
     * @param string|null $successorRel The Link rel of the successor, an RFC 8288 registered relation name; present if and only if 'successor' is (invariant ir.deprecation.headers).
     */
    public function __construct(
        public string $since,
        public string $sunset,
        public Origin $origin,
        public ?OperationRef $successor = null,
        public ?string $successorRel = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Deprecation');

        return new self(
            since: IrHydration::string(IrHydration::required($members, 'since', 'Deprecation'), 'Deprecation.since'),
            sunset: IrHydration::string(IrHydration::required($members, 'sunset', 'Deprecation'), 'Deprecation.sunset'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Deprecation')),
            successor: IrHydration::optional($members, 'successor', static fn (mixed $item): OperationRef => OperationRef::fromJson($item)),
            successorRel: IrHydration::optional($members, 'successorRel', static fn (mixed $item): string => IrHydration::string($item, 'Deprecation.successorRel')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'since'} = $this->since;
        $json->{'sunset'} = $this->sunset;
        if ($this->successor !== null) {
            $json->{'successor'} = $this->successor->toJson();
        }
        if ($this->successorRel !== null) {
            $json->{'successorRel'} = $this->successorRel;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
