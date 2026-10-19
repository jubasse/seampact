<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
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
     * @param Docs|null $docs The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
     * @param list<mixed>|null $examples The examples written at the position of this use, placed as its docs are.
     */
    public function __construct(
        public string $schema,
        public ?UnknownKeys $unknownKeys = null,
        public ?bool $nullable = null,
        public ?Docs $docs = null,
        public ?array $examples = null,
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
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'RefTypeUse.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
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
        if ($this->docs !== null) {
            $json->{'docs'} = $this->docs->toJson();
        }
        if ($this->examples !== null) {
            $json->{'examples'} = IrHydration::encodeList($this->examples, static fn (mixed $item): mixed => IrHydration::copy($item));
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
