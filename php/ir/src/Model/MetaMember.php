<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A member of the format's $meta: 'source' set if and only if 'fill' is 'source' (invariant ir.meta.source). */
final readonly class MetaMember
{
    /**
     * @param TypeUse $type
     * @param MetaFill $fill
     * @param ValueSource|null $source
     */
    public function __construct(
        public TypeUse $type,
        public MetaFill $fill,
        public ?ValueSource $source = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'MetaMember');

        return new self(
            type: TypeUse::fromJson(IrHydration::required($members, 'type', 'MetaMember')),
            fill: MetaFill::fromJson(IrHydration::required($members, 'fill', 'MetaMember')),
            source: IrHydration::optional($members, 'source', static fn (mixed $item): ValueSource => ValueSource::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'type'} = $this->type->toJson();
        $json->{'fill'} = $this->fill->toJson();
        if ($this->source !== null) {
            $json->{'source'} = $this->source->toJson();
        }
        return $json;
    }
}
