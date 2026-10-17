<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class MapSchema extends Schema
{
    /** The tag member 'kind': fixed to 'map'. */
    public string $kind;

    /**
     * @param TypeUse $values
     * @param string $id
     * @param Name $name
     * @param list<Direction> $directions
     * @param list<mixed> $examples
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param TypeUse|null $keys
     * @param string|null $typeName
     */
    public function __construct(
        public TypeUse $values,
        public string $id,
        public Name $name,
        public array $directions,
        public array $examples,
        public Docs $docs,
        public \stdClass $extensions,
        public Origin $origin,
        public ?TypeUse $keys = null,
        public ?string $typeName = null,
    ) {
        $this->kind = 'map';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'MapSchema');
        IrHydration::tag($members, 'kind', 'map', 'MapSchema');

        return new self(
            values: TypeUse::fromJson(IrHydration::required($members, 'values', 'MapSchema')),
            id: IrHydration::string(IrHydration::required($members, 'id', 'MapSchema'), 'MapSchema.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'MapSchema')),
            directions: IrHydration::listOf(IrHydration::required($members, 'directions', 'MapSchema'), 'MapSchema.directions', static fn (mixed $item): Direction => Direction::fromJson($item)),
            examples: IrHydration::listOf(IrHydration::required($members, 'examples', 'MapSchema'), 'MapSchema.examples', static fn (mixed $item): mixed => $item),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'MapSchema')),
            extensions: IrHydration::object(IrHydration::required($members, 'extensions', 'MapSchema'), 'MapSchema.extensions'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'MapSchema')),
            keys: IrHydration::optional($members, 'keys', static fn (mixed $item): TypeUse => TypeUse::fromJson($item)),
            typeName: IrHydration::optional($members, 'typeName', static fn (mixed $item): string => IrHydration::string($item, 'MapSchema.typeName')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        if ($this->keys !== null) {
            $json->{'keys'} = $this->keys->toJson();
        }
        $json->{'values'} = $this->values->toJson();
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        if ($this->typeName !== null) {
            $json->{'typeName'} = $this->typeName;
        }
        $json->{'directions'} = IrHydration::encodeList($this->directions, static fn (Direction $item): mixed => $item->toJson());
        $json->{'examples'} = $this->examples;
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = $this->extensions;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
