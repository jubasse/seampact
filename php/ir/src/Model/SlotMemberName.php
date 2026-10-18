<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SlotMemberName extends MemberName
{
    /** The tag member 'kind': fixed to 'slot'. */
    public string $kind;

    /**
     * @param string $slot
     */
    public function __construct(
        public string $slot,
    ) {
        $this->kind = 'slot';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SlotMemberName');
        IrHydration::tag($members, 'kind', 'slot', 'SlotMemberName');

        return new self(
            slot: IrHydration::string(IrHydration::required($members, 'slot', 'SlotMemberName'), 'SlotMemberName.slot'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'slot'} = $this->slot;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
