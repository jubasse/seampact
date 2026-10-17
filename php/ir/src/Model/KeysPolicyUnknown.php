<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */
final readonly class KeysPolicyUnknown extends KeysPolicy
{
    private \stdClass $raw;

    public function __construct(
        public string $policy,
        \stdClass $raw,
    ) {
        if (in_array($policy, ['ignore', 'keep'], true)) {
            throw new IrModelException('KeysPolicyUnknown: the policy is a known one');
        }
        if (($raw->{'policy'} ?? null) !== $policy) {
            throw new IrModelException('KeysPolicyUnknown: raw does not carry the policy');
        }
        $this->raw = IrHydration::copyObject($raw);
    }

    public function tag(): string
    {
        return $this->policy;
    }

    /** A copy: the kept raw object cannot be changed through it. */
    public function raw(): \stdClass
    {
        return IrHydration::copyObject($this->raw);
    }

    public function toJson(): \stdClass
    {
        return IrHydration::copyObject($this->raw);
    }
}
