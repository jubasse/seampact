<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SchemaPrincipal extends Principal
{
    /** The tag member 'kind': fixed to 'schema'. */
    public string $kind;

    /**
     * @param string $schema
     */
    public function __construct(
        public string $schema,
    ) {
        $this->kind = 'schema';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SchemaPrincipal');
        IrHydration::tag($members, 'kind', 'schema', 'SchemaPrincipal');

        return new self(
            schema: IrHydration::string(IrHydration::required($members, 'schema', 'SchemaPrincipal'), 'SchemaPrincipal.schema'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'schema'} = $this->schema;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
