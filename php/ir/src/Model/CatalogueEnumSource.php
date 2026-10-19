<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class CatalogueEnumSource extends EnumSource
{
    /** The tag member 'kind': fixed to 'enum'. */
    public string $kind;

    /**
     * @param string $enum
     */
    public function __construct(
        public string $enum,
    ) {
        $this->kind = 'enum';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CatalogueEnumSource');
        IrHydration::tag($members, 'kind', 'enum', 'CatalogueEnumSource');

        return new self(
            enum: IrHydration::string(IrHydration::required($members, 'enum', 'CatalogueEnumSource'), 'CatalogueEnumSource.enum'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'enum'} = $this->enum;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
