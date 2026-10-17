<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class EnumTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'enum'. */
    public string $kind;

    /**
     * @param string $enum
     * @param EnumNarrowing|null $narrowedTo
     * @param bool|null $nullable The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
     */
    public function __construct(
        public string $enum,
        public ?EnumNarrowing $narrowedTo = null,
        public ?bool $nullable = null,
    ) {
        $this->kind = 'enum';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'EnumTypeUse');
        IrHydration::tag($members, 'kind', 'enum', 'EnumTypeUse');

        return new self(
            enum: IrHydration::string(IrHydration::required($members, 'enum', 'EnumTypeUse'), 'EnumTypeUse.enum'),
            narrowedTo: IrHydration::optional($members, 'narrowedTo', static fn (mixed $item): EnumNarrowing => EnumNarrowing::fromJson($item)),
            nullable: IrHydration::optional($members, 'nullable', static fn (mixed $item): bool => IrHydration::boolean($item, 'EnumTypeUse.nullable')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'enum'} = $this->enum;
        if ($this->narrowedTo !== null) {
            $json->{'narrowedTo'} = $this->narrowedTo->toJson();
        }
        if ($this->nullable !== null) {
            $json->{'nullable'} = $this->nullable;
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
