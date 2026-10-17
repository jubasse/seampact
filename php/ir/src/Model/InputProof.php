<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A body field the compiler adds to the input for a rule proof read in the body (derivation 'rule.proof'): required and sensitive (ADR 0002 section 9). A proof read in a header is a derived header parameter. */
final readonly class InputProof
{
    /**
     * @param string $name
     * @param TypeUse $schema
     * @param DerivedFrom $derivedFrom
     * @param FieldWire|null $wire The proof's wire form, as an input field's: present exactly when the input's media is form or multipart, and never of kind 'file' (invariant ir.input-proof.wire).
     */
    public function __construct(
        public string $name,
        public TypeUse $schema,
        public DerivedFrom $derivedFrom,
        public ?FieldWire $wire = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'InputProof');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'InputProof'), 'InputProof.name'),
            schema: TypeUse::fromJson(IrHydration::required($members, 'schema', 'InputProof')),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'InputProof')),
            wire: IrHydration::optional($members, 'wire', static fn (mixed $item): FieldWire => FieldWire::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'schema'} = $this->schema->toJson();
        if ($this->wire !== null) {
            $json->{'wire'} = $this->wire->toJson();
        }
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }
}
