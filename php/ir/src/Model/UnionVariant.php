<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class UnionVariant
{
    /**
     * @param string $tag
     * @param string $schema
     * @param Docs|null $docs The docs written on the variant itself, beside its schema reference.
     */
    public function __construct(
        public string $tag,
        public string $schema,
        public ?Docs $docs = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'UnionVariant');

        return new self(
            tag: IrHydration::string(IrHydration::required($members, 'tag', 'UnionVariant'), 'UnionVariant.tag'),
            schema: IrHydration::string(IrHydration::required($members, 'schema', 'UnionVariant'), 'UnionVariant.schema'),
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'tag'} = $this->tag;
        $json->{'schema'} = $this->schema;
        if ($this->docs !== null) {
            $json->{'docs'} = $this->docs->toJson();
        }
        return $json;
    }
}
