<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A declared extension key (ADR 0002 section 12). */
final readonly class ExtensionKeyDecl
{
    /**
     * @param string $id
     * @param string $prefix
     * @param string $key
     * @param TypeUse $schema
     * @param list<ExtensionPlace> $places
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public string $prefix,
        public string $key,
        public TypeUse $schema,
        public array $places,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ExtensionKeyDecl');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'ExtensionKeyDecl'), 'ExtensionKeyDecl.id'),
            prefix: IrHydration::string(IrHydration::required($members, 'prefix', 'ExtensionKeyDecl'), 'ExtensionKeyDecl.prefix'),
            key: IrHydration::string(IrHydration::required($members, 'key', 'ExtensionKeyDecl'), 'ExtensionKeyDecl.key'),
            schema: TypeUse::fromJson(IrHydration::required($members, 'schema', 'ExtensionKeyDecl')),
            places: IrHydration::listOf(IrHydration::required($members, 'places', 'ExtensionKeyDecl'), 'ExtensionKeyDecl.places', static fn (mixed $item): ExtensionPlace => ExtensionPlace::fromJson($item)),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'ExtensionKeyDecl')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'prefix'} = $this->prefix;
        $json->{'key'} = $this->key;
        $json->{'schema'} = $this->schema->toJson();
        $json->{'places'} = IrHydration::encodeList($this->places, static fn (ExtensionPlace $item): mixed => $item->toJson());
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
