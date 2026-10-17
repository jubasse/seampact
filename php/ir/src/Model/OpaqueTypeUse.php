<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Any JSON value, unchecked (ADR 0003 section 2). */
final readonly class OpaqueTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'opaque'. */
    public string $kind;

    /**
     * @param string $reason
     * @param Origin $origin
     */
    public function __construct(
        public string $reason,
        public Origin $origin,
    ) {
        $this->kind = 'opaque';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OpaqueTypeUse');
        IrHydration::tag($members, 'kind', 'opaque', 'OpaqueTypeUse');

        return new self(
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'OpaqueTypeUse'), 'OpaqueTypeUse.reason'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OpaqueTypeUse')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'reason'} = $this->reason;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
