<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ArrayTemplate extends Template
{
    /** The tag member 'kind': fixed to 'array'. */
    public string $kind;

    /**
     * @param list<Template> $items
     */
    public function __construct(
        public array $items,
    ) {
        $this->kind = 'array';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ArrayTemplate');
        IrHydration::tag($members, 'kind', 'array', 'ArrayTemplate');

        return new self(
            items: IrHydration::listOf(IrHydration::required($members, 'items', 'ArrayTemplate'), 'ArrayTemplate.items', static fn (mixed $item): Template => Template::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'items'} = IrHydration::encodeList($this->items, static fn (Template $item): mixed => $item->toJson());
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
