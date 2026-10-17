<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ArrayTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'array'. */
    public string $kind;

    /**
     * @param TypeUse $items
     * @param int|null $minItems
     * @param int|null $maxItems
     * @param bool|null $nullable The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
     */
    public function __construct(
        public TypeUse $items,
        public ?int $minItems = null,
        public ?int $maxItems = null,
        public ?bool $nullable = null,
    ) {
        $this->kind = 'array';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ArrayTypeUse');
        IrHydration::tag($members, 'kind', 'array', 'ArrayTypeUse');

        return new self(
            items: TypeUse::fromJson(IrHydration::required($members, 'items', 'ArrayTypeUse')),
            minItems: IrHydration::optional($members, 'minItems', static fn (mixed $item): int => IrHydration::integer($item, 'ArrayTypeUse.minItems')),
            maxItems: IrHydration::optional($members, 'maxItems', static fn (mixed $item): int => IrHydration::integer($item, 'ArrayTypeUse.maxItems')),
            nullable: IrHydration::optional($members, 'nullable', static fn (mixed $item): bool => IrHydration::boolean($item, 'ArrayTypeUse.nullable')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'items'} = $this->items->toJson();
        if ($this->minItems !== null) {
            $json->{'minItems'} = $this->minItems;
        }
        if ($this->maxItems !== null) {
            $json->{'maxItems'} = $this->maxItems;
        }
        if ($this->nullable !== null) {
            $json->{'nullable'} = $this->nullable;
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
