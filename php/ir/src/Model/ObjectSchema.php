<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ObjectSchema extends Schema
{
    /** The tag member 'kind': fixed to 'object'. */
    public string $kind;

    private \stdClass $extensions;

    /**
     * @param list<Property> $properties
     * @param string $id
     * @param Name $name
     * @param list<Direction> $directions
     * @param list<mixed> $examples
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param string|null $typeName
     * @param bool|null $deprecated The schema is deprecated (ADR 0003 section 1); absent means false.
     */
    public function __construct(
        public array $properties,
        public string $id,
        public Name $name,
        public array $directions,
        public array $examples,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?string $typeName = null,
        public ?bool $deprecated = null,
    ) {
        $this->kind = 'object';
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ObjectSchema');
        IrHydration::tag($members, 'kind', 'object', 'ObjectSchema');

        return new self(
            properties: IrHydration::listOf(IrHydration::required($members, 'properties', 'ObjectSchema'), 'ObjectSchema.properties', static fn (mixed $item): Property => Property::fromJson($item)),
            id: IrHydration::string(IrHydration::required($members, 'id', 'ObjectSchema'), 'ObjectSchema.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'ObjectSchema')),
            directions: IrHydration::listOf(IrHydration::required($members, 'directions', 'ObjectSchema'), 'ObjectSchema.directions', static fn (mixed $item): Direction => Direction::fromJson($item)),
            examples: IrHydration::listOf(IrHydration::required($members, 'examples', 'ObjectSchema'), 'ObjectSchema.examples', static fn (mixed $item): mixed => IrHydration::copy($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'ObjectSchema')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'ObjectSchema'), 'ObjectSchema.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'ObjectSchema')),
            typeName: IrHydration::optional($members, 'typeName', static fn (mixed $item): string => IrHydration::string($item, 'ObjectSchema.typeName')),
            deprecated: IrHydration::optional($members, 'deprecated', static fn (mixed $item): bool => IrHydration::boolean($item, 'ObjectSchema.deprecated')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'properties'} = IrHydration::encodeList($this->properties, static fn (Property $item): mixed => $item->toJson());
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
        if ($this->deprecated !== null) {
            $json->{'deprecated'} = $this->deprecated;
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
