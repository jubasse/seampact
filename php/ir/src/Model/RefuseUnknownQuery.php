<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RefuseUnknownQuery extends UnknownQuery
{
    /** The tag member 'policy': fixed to 'refuse'. */
    public string $policy;

    public function __construct(
    ) {
        $this->policy = 'refuse';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RefuseUnknownQuery');
        IrHydration::tag($members, 'policy', 'refuse', 'RefuseUnknownQuery');

        return new self(
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'policy'} = $this->policy;
        return $json;
    }

    public function tag(): string
    {
        return $this->policy;
    }
}
