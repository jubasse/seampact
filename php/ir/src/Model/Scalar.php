<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A named format of the scalars catalogue: a base type plus refinements (ADR 0003 section 8). Its own type holds no 'scalar'. */
final readonly class Scalar
{
    /**
     * @param string $id
     * @param Name $name
     * @param ScalarTypeUse $type
     * @param list<Direction> $directions
     * @param Docs $docs
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public Name $name,
        public ScalarTypeUse $type,
        public array $directions,
        public Docs $docs,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Scalar');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'Scalar'), 'Scalar.id'),
            name: Name::fromJson(IrHydration::required($members, 'name', 'Scalar')),
            type: ScalarTypeUse::fromJson(IrHydration::required($members, 'type', 'Scalar')),
            directions: IrHydration::listOf(IrHydration::required($members, 'directions', 'Scalar'), 'Scalar.directions', static fn (mixed $item): Direction => Direction::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'Scalar')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Scalar')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'name'} = $this->name->toJson();
        $json->{'type'} = $this->type->toJson();
        $json->{'directions'} = IrHydration::encodeList($this->directions, static fn (Direction $item): mixed => $item->toJson());
        $json->{'docs'} = $this->docs->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
