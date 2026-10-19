<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class OperationMaturity
{
    /**
     * @param Maturity $level
     * @param MaturitySource $source
     * @param Origin $origin
     * @param string|null $reason
     */
    public function __construct(
        public Maturity $level,
        public MaturitySource $source,
        public Origin $origin,
        public ?string $reason = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationMaturity');

        return new self(
            level: Maturity::fromJson(IrHydration::required($members, 'level', 'OperationMaturity')),
            source: MaturitySource::fromJson(IrHydration::required($members, 'source', 'OperationMaturity')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OperationMaturity')),
            reason: IrHydration::optional($members, 'reason', static fn (mixed $item): string => IrHydration::string($item, 'OperationMaturity.reason')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'level'} = $this->level->toJson();
        $json->{'source'} = $this->source->toJson();
        if ($this->reason !== null) {
            $json->{'reason'} = $this->reason;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
