<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PublicAccess extends Access
{
    /** The tag member 'kind': fixed to 'public'. */
    public string $kind;

    /**
     * @param string $reason
     * @param Origin $origin
     */
    public function __construct(
        public string $reason,
        public Origin $origin,
    ) {
        $this->kind = 'public';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PublicAccess');
        IrHydration::tag($members, 'kind', 'public', 'PublicAccess');

        return new self(
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'PublicAccess'), 'PublicAccess.reason'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'PublicAccess')),
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
