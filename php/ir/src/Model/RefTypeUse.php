<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RefTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'ref'. */
    public string $kind;

    /**
     * @param string $schema
     * @param UnknownKeys|null $unknownKeys
     * @param bool|null $nullable The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
     */
    public function __construct(
        public string $schema,
        public ?UnknownKeys $unknownKeys = null,
        public ?bool $nullable = null,
    ) {
        $this->kind = 'ref';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RefTypeUse');
        IrHydration::tag($members, 'kind', 'ref', 'RefTypeUse');

        return new self(
            schema: IrHydration::string(IrHydration::required($members, 'schema', 'RefTypeUse'), 'RefTypeUse.schema'),
            unknownKeys: IrHydration::optional($members, 'unknownKeys', static fn (mixed $item): UnknownKeys => UnknownKeys::fromJson($item)),
            nullable: IrHydration::optional($members, 'nullable', static fn (mixed $item): bool => IrHydration::boolean($item, 'RefTypeUse.nullable')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'schema'} = $this->schema;
        if ($this->unknownKeys !== null) {
            $json->{'unknownKeys'} = $this->unknownKeys->toJson();
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
