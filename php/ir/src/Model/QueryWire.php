<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The wire form of a query parameter (FR-30). */
final readonly class QueryWire
{
    /**
     * @param QueryWireKind $kind
     * @param QueryStyle $style
     * @param bool $explode
     * @param bool $brackets A list sent as 'name[]'.
     */
    public function __construct(
        public QueryWireKind $kind,
        public QueryStyle $style,
        public bool $explode,
        public bool $brackets,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'QueryWire');

        return new self(
            kind: QueryWireKind::fromJson(IrHydration::required($members, 'kind', 'QueryWire')),
            style: QueryStyle::fromJson(IrHydration::required($members, 'style', 'QueryWire')),
            explode: IrHydration::boolean(IrHydration::required($members, 'explode', 'QueryWire'), 'QueryWire.explode'),
            brackets: IrHydration::boolean(IrHydration::required($members, 'brackets', 'QueryWire'), 'QueryWire.brackets'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind->toJson();
        $json->{'style'} = $this->style->toJson();
        $json->{'explode'} = $this->explode;
        $json->{'brackets'} = $this->brackets;
        return $json;
    }
}
