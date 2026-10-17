<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class IgnoreUnknownQuery extends UnknownQuery
{
    /** The tag member 'policy': fixed to 'ignore'. */
    public string $policy;

    /**
     * @param string $reason
     * @param Origin $origin
     */
    public function __construct(
        public string $reason,
        public Origin $origin,
    ) {
        $this->policy = 'ignore';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'IgnoreUnknownQuery');
        IrHydration::tag($members, 'policy', 'ignore', 'IgnoreUnknownQuery');

        return new self(
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'IgnoreUnknownQuery'), 'IgnoreUnknownQuery.reason'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'IgnoreUnknownQuery')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'policy'} = $this->policy;
        $json->{'reason'} = $this->reason;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->policy;
    }
}
