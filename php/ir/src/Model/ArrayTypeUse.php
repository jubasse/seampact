<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
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
     * @param Docs|null $docs The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
     * @param list<mixed>|null $examples The examples written at the position of this use, placed as its docs are.
     */
    public function __construct(
        public TypeUse $items,
        public ?int $minItems = null,
        public ?int $maxItems = null,
        public ?bool $nullable = null,
        public ?Docs $docs = null,
        public ?array $examples = null,
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
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'ArrayTypeUse.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
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
        if ($this->docs !== null) {
            $json->{'docs'} = $this->docs->toJson();
        }
        if ($this->examples !== null) {
            $json->{'examples'} = IrHydration::encodeList($this->examples, static fn (mixed $item): mixed => IrHydration::copy($item));
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
