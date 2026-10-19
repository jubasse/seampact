<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The wire form of a form or multipart field: a query wire kind with style, explode and brackets, or kind 'file' or 'json' alone (invariant ir.field-wire.members). */
final readonly class FieldWire
{
    /**
     * @param FieldWireKind $kind
     * @param QueryStyle|null $style
     * @param bool|null $explode
     * @param bool|null $brackets
     */
    public function __construct(
        public FieldWireKind $kind,
        public ?QueryStyle $style = null,
        public ?bool $explode = null,
        public ?bool $brackets = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'FieldWire');

        return new self(
            kind: FieldWireKind::fromJson(IrHydration::required($members, 'kind', 'FieldWire')),
            style: IrHydration::optional($members, 'style', static fn (mixed $item): QueryStyle => QueryStyle::fromJson($item)),
            explode: IrHydration::optional($members, 'explode', static fn (mixed $item): bool => IrHydration::boolean($item, 'FieldWire.explode')),
            brackets: IrHydration::optional($members, 'brackets', static fn (mixed $item): bool => IrHydration::boolean($item, 'FieldWire.brackets')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind->toJson();
        if ($this->style !== null) {
            $json->{'style'} = $this->style->toJson();
        }
        if ($this->explode !== null) {
            $json->{'explode'} = $this->explode;
        }
        if ($this->brackets !== null) {
            $json->{'brackets'} = $this->brackets;
        }
        return $json;
    }
}
