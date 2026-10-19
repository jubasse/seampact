<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An enum; values keep the written order (ADR 0004 section 4). */
final readonly class Enum_
{
    /**
     * @param string $id
     * @param Name $name
     * @param list<string> $values
     * @param list<Direction> $directions
     * @param Docs $docs
     * @param Origin $origin
     * @param array<int|string, Name>|null $codeNames Identifier override per value (ADR 0007).
     * @param EnumSource|null $source
     * @param string|null $localReason
     * @param string|null $fallback
     */
    public function __construct(
        public string $id,
        public Name $name,
        public array $values,
        public array $directions,
        public Docs $docs,
        public Origin $origin,
        public ?array $codeNames = null,
        public ?EnumSource $source = null,
        public ?string $localReason = null,
        public ?string $fallback = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Enum');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Enum'), 'Enum.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'Enum')),
            values: IrHydration::listOf(IrHydration::required($members, 'values', 'Enum'), 'Enum.values', static fn (mixed $item): string => IrHydration::string($item, 'Enum.values[]')),
            directions: IrHydration::listOf(IrHydration::required($members, 'directions', 'Enum'), 'Enum.directions', static fn (mixed $item): Direction => Direction::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Enum')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Enum')),
            codeNames: IrHydration::optional($members, 'codeNames', static fn (mixed $item): array => IrHydration::mapOf($item, 'Enum.codeNames', static fn (mixed $item): Name => Name::fromJson($item))),
            source: IrHydration::optional($members, 'source', static fn (mixed $item): EnumSource => EnumSource::fromJson($item)),
            localReason: IrHydration::optional($members, 'localReason', static fn (mixed $item): string => IrHydration::string($item, 'Enum.localReason')),
            fallback: IrHydration::optional($members, 'fallback', static fn (mixed $item): string => IrHydration::string($item, 'Enum.fallback')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        $json->{'values'} = $this->values;
        if ($this->codeNames !== null) {
            $json->{'codeNames'} = IrHydration::encodeMap($this->codeNames, static fn (Name $item): mixed => $item->toJson());
        }
        if ($this->source !== null) {
            $json->{'source'} = $this->source->toJson();
        }
        if ($this->localReason !== null) {
            $json->{'localReason'} = $this->localReason;
        }
        if ($this->fallback !== null) {
            $json->{'fallback'} = $this->fallback;
        }
        $json->{'directions'} = IrHydration::encodeList($this->directions, static fn (Direction $item): mixed => $item->toJson());
        $json->{'docs'} = $this->docs->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
