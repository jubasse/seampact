<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RuleProof
{
    /**
     * @param ProofPlacement $in
     * @param string $name
     * @param TypeUse $schema
     */
    public function __construct(
        public ProofPlacement $in,
        public string $name,
        public TypeUse $schema,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RuleProof');

        return new self(
            in: ProofPlacement::fromJson(IrHydration::required($members, 'in', 'RuleProof')),
            name: IrHydration::string(IrHydration::required($members, 'name', 'RuleProof'), 'RuleProof.name'),
            schema: TypeUse::fromJson(IrHydration::required($members, 'schema', 'RuleProof')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'in'} = $this->in->toJson();
        $json->{'name'} = $this->name;
        $json->{'schema'} = $this->schema->toJson();
        return $json;
    }
}
