<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SlotTemplate extends Template
{
    /** The tag member 'kind': fixed to 'slot'. */
    public string $kind;

    /**
     * @param string $slot
     * @param list<string> $path
     */
    public function __construct(
        public string $slot,
        public array $path,
    ) {
        $this->kind = 'slot';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SlotTemplate');
        IrHydration::tag($members, 'kind', 'slot', 'SlotTemplate');

        return new self(
            slot: IrHydration::string(IrHydration::required($members, 'slot', 'SlotTemplate'), 'SlotTemplate.slot'),
            path: IrHydration::listOf(IrHydration::required($members, 'path', 'SlotTemplate'), 'SlotTemplate.path', static fn (mixed $item): string => IrHydration::string($item, 'SlotTemplate.path[]')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'slot'} = $this->slot;
        $json->{'path'} = $this->path;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
