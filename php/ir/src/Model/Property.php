<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An object property; the wire name stays 'name' (ADR 0004 section 5). */
final readonly class Property
{
    private \stdClass $extensions;

    /**
     * @param string $name
     * @param TypeUse $type
     * @param bool $optional
     * @param bool $nullable
     * @param bool $sensitive
     * @param bool $deprecated
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param FieldRestriction|null $restrictedTo
     * @param IrOpaque|null $default
     * @param Name|null $codeName
     * @param DerivedFrom|null $derivedFrom
     * @param list<mixed>|null $examples The examples written on the property, each parsed against its type (ADR 0003 section 11).
     */
    public function __construct(
        public string $name,
        public TypeUse $type,
        public bool $optional,
        public bool $nullable,
        public bool $sensitive,
        public bool $deprecated,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?FieldRestriction $restrictedTo = null,
        public ?IrOpaque $default = null,
        public ?Name $codeName = null,
        public ?DerivedFrom $derivedFrom = null,
        public ?array $examples = null,
    ) {
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Property');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'Property'), 'Property.name'),
            type: TypeUse::fromJson(IrHydration::required($members, 'type', 'Property')),
            optional: IrHydration::boolean(IrHydration::required($members, 'optional', 'Property'), 'Property.optional'),
            nullable: IrHydration::boolean(IrHydration::required($members, 'nullable', 'Property'), 'Property.nullable'),
            sensitive: IrHydration::boolean(IrHydration::required($members, 'sensitive', 'Property'), 'Property.sensitive'),
            deprecated: IrHydration::boolean(IrHydration::required($members, 'deprecated', 'Property'), 'Property.deprecated'),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Property')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'Property'), 'Property.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Property')),
            restrictedTo: IrHydration::optional($members, 'restrictedTo', static fn (mixed $item): FieldRestriction => FieldRestriction::fromJson($item)),
            default: IrHydration::optionalOpaque($members, 'default'),
            codeName: IrHydration::optional($members, 'codeName', static fn (mixed $item): Name => Name::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'Property.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'type'} = $this->type->toJson();
        $json->{'optional'} = $this->optional;
        $json->{'nullable'} = $this->nullable;
        $json->{'sensitive'} = $this->sensitive;
        if ($this->restrictedTo !== null) {
            $json->{'restrictedTo'} = $this->restrictedTo->toJson();
        }
        if ($this->default !== null) {
            $json->{'default'} = IrHydration::copy($this->default->value());
        }
        $json->{'deprecated'} = $this->deprecated;
        if ($this->codeName !== null) {
            $json->{'codeName'} = $this->codeName->toJson();
        }
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->examples !== null) {
            $json->{'examples'} = IrHydration::encodeList($this->examples, static fn (mixed $item): mixed => IrHydration::copy($item));
        }
        return $json;
    }
}
