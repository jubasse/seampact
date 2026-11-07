<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A nature of the contract (ADR 0002 section 11). */
final readonly class NatureDecl
{
    /**
     * @param string $id
     * @param NatureBase $base
     * @param Docs $docs
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public NatureBase $base,
        public Docs $docs,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'NatureDecl');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'NatureDecl'), 'NatureDecl.id'),
            base: NatureBase::fromJson(IrHydration::required($members, 'base', 'NatureDecl')),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'NatureDecl')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'NatureDecl')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'base'} = $this->base->toJson();
        $json->{'docs'} = $this->docs->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
