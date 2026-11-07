<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Unknown keys of an input use (ADR 0003 section 4). */
final readonly class UnknownKeys
{
    /**
     * @param UnknownKeysPolicy $policy
     * @param string|null $reason
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public UnknownKeysPolicy $policy,
        public ?string $reason = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'UnknownKeys');

        return new self(
            policy: UnknownKeysPolicy::fromJson(IrHydration::required($members, 'policy', 'UnknownKeys')),
            reason: IrHydration::optional($members, 'reason', static fn (mixed $item): string => IrHydration::string($item, 'UnknownKeys.reason')),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'policy'} = $this->policy->toJson();
        if ($this->reason !== null) {
            $json->{'reason'} = $this->reason;
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
