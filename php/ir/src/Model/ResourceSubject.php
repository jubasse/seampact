<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ResourceSubject extends RightSubject
{
    /** The tag member 'kind': fixed to 'resource'. */
    public string $kind;

    /**
     * @param Name $type
     * @param TypeUse $idSchema
     */
    public function __construct(
        public Name $type,
        public TypeUse $idSchema,
    ) {
        $this->kind = 'resource';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ResourceSubject');
        IrHydration::tag($members, 'kind', 'resource', 'ResourceSubject');

        return new self(
            type: Name::fromJson(IrHydration::required($members, 'type', 'ResourceSubject')),
            idSchema: TypeUse::fromJson(IrHydration::required($members, 'idSchema', 'ResourceSubject')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'type'} = $this->type->toJson();
        $json->{'idSchema'} = $this->idSchema->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
