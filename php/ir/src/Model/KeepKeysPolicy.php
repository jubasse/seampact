<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class KeepKeysPolicy extends KeysPolicy
{
    /** The tag member 'policy': fixed to 'keep'. */
    public string $policy;

    /**
     * @param string $reason
     */
    public function __construct(
        public string $reason,
    ) {
        $this->policy = 'keep';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'KeepKeysPolicy');
        IrHydration::tag($members, 'policy', 'keep', 'KeepKeysPolicy');

        return new self(
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'KeepKeysPolicy'), 'KeepKeysPolicy.reason'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'policy'} = $this->policy;
        $json->{'reason'} = $this->reason;
        return $json;
    }

    public function tag(): string
    {
        return $this->policy;
    }
}
