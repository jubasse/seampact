<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class UnionSchema extends Schema
{
    /** The tag member 'kind': fixed to 'union'. */
    public string $kind;

    private \stdClass $extensions;

    /**
     * @param UnionTag $tag
     * @param list<UnionVariant> $variants
     * @param string $id
     * @param Name $name
     * @param list<Direction> $directions
     * @param list<mixed> $examples
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param string|null $typeName
     */
    public function __construct(
        public UnionTag $tag,
        public array $variants,
        public string $id,
        public Name $name,
        public array $directions,
        public array $examples,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?string $typeName = null,
    ) {
        $this->kind = 'union';
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'UnionSchema');
        IrHydration::tag($members, 'kind', 'union', 'UnionSchema');

        return new self(
            tag: UnionTag::fromJson(IrHydration::required($members, 'tag', 'UnionSchema')),
            variants: IrHydration::listOf(IrHydration::required($members, 'variants', 'UnionSchema'), 'UnionSchema.variants', static fn (mixed $item): UnionVariant => UnionVariant::fromJson($item)),
            id: IrHydration::string(IrHydration::required($members, 'id', 'UnionSchema'), 'UnionSchema.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'UnionSchema')),
            directions: IrHydration::listOf(IrHydration::required($members, 'directions', 'UnionSchema'), 'UnionSchema.directions', static fn (mixed $item): Direction => Direction::fromJson($item)),
            examples: IrHydration::listOf(IrHydration::required($members, 'examples', 'UnionSchema'), 'UnionSchema.examples', static fn (mixed $item): mixed => IrHydration::copy($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'UnionSchema')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'UnionSchema'), 'UnionSchema.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'UnionSchema')),
            typeName: IrHydration::optional($members, 'typeName', static fn (mixed $item): string => IrHydration::string($item, 'UnionSchema.typeName')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'tag'} = $this->tag->toJson();
        $json->{'variants'} = IrHydration::encodeList($this->variants, static fn (UnionVariant $item): mixed => $item->toJson());
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        if ($this->typeName !== null) {
            $json->{'typeName'} = $this->typeName;
        }
        $json->{'directions'} = IrHydration::encodeList($this->directions, static fn (Direction $item): mixed => $item->toJson());
        $json->{'examples'} = IrHydration::encodeList($this->examples, static fn (mixed $item): mixed => IrHydration::copy($item));
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
