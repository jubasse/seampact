<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A scalar use. A use of a named format names it in 'scalar' and holds its type and refinements inline, so a target that does not map the named format still checks it (ADR 0003 section 8). */
final readonly class ScalarTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'scalar'. */
    public string $kind;

    /**
     * @param ScalarType $type
     * @param Refinements $refinements
     * @param string|null $format A portable format of ADR 0003 section 8 ('uuid', 'int64', 'decimal'...); a named format is 'scalar'.
     * @param string|null $scalar The named format this use reads, from the scalars catalogue.
     * @param JsonContent|null $content
     * @param bool|null $nullable The value may be JSON null (ADR 0003 section 5); absent means false. A property's own type use leaves it out: Property.nullable holds it (invariant ir.property.nullable).
     * @param Docs|null $docs The docs written on a nested position: the items of an array use, the keys or values of a map schema, the schema of a JSON content. Any other type use leaves them out, since its holder keeps them, and an inline object, map or union keeps them on its hoisted schema (invariant ir.type-use.annotations).
     * @param list<mixed>|null $examples The examples written on a nested position, placed as docs are (invariant ir.type-use.annotations).
     */
    public function __construct(
        public ScalarType $type,
        public Refinements $refinements,
        public ?string $format = null,
        public ?string $scalar = null,
        public ?JsonContent $content = null,
        public ?bool $nullable = null,
        public ?Docs $docs = null,
        public ?array $examples = null,
    ) {
        $this->kind = 'scalar';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ScalarTypeUse');
        IrHydration::tag($members, 'kind', 'scalar', 'ScalarTypeUse');

        return new self(
            type: ScalarType::fromJson(IrHydration::required($members, 'type', 'ScalarTypeUse')),
            refinements: Refinements::fromJson(IrHydration::required($members, 'refinements', 'ScalarTypeUse')),
            format: IrHydration::optional($members, 'format', static fn (mixed $item): string => IrHydration::string($item, 'ScalarTypeUse.format')),
            scalar: IrHydration::optional($members, 'scalar', static fn (mixed $item): string => IrHydration::string($item, 'ScalarTypeUse.scalar')),
            content: IrHydration::optional($members, 'content', static fn (mixed $item): JsonContent => JsonContent::fromJson($item)),
            nullable: IrHydration::optional($members, 'nullable', static fn (mixed $item): bool => IrHydration::boolean($item, 'ScalarTypeUse.nullable')),
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'ScalarTypeUse.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'type'} = $this->type->toJson();
        if ($this->format !== null) {
            $json->{'format'} = $this->format;
        }
        if ($this->scalar !== null) {
            $json->{'scalar'} = $this->scalar;
        }
        $json->{'refinements'} = $this->refinements->toJson();
        if ($this->content !== null) {
            $json->{'content'} = $this->content->toJson();
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
