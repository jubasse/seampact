<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Any JSON value, unchecked (ADR 0003 section 2). */
final readonly class OpaqueTypeUse extends TypeUse
{
    /** The tag member 'kind': fixed to 'opaque'. */
    public string $kind;

    /**
     * @param string $reason
     * @param Origin $origin
     * @param Docs|null $docs The docs written at the position of this use (today the compiler writes them on array items, map keys or values and JSON content schemas). An inline object, map or union keeps them on its hoisted schema; a property and a named format hold their own.
     * @param list<mixed>|null $examples The examples written at the position of this use, placed as its docs are.
     */
    public function __construct(
        public string $reason,
        public Origin $origin,
        public ?Docs $docs = null,
        public ?array $examples = null,
    ) {
        $this->kind = 'opaque';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OpaqueTypeUse');
        IrHydration::tag($members, 'kind', 'opaque', 'OpaqueTypeUse');

        return new self(
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'OpaqueTypeUse'), 'OpaqueTypeUse.reason'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OpaqueTypeUse')),
            docs: IrHydration::optional($members, 'docs', static fn (mixed $item): Docs => Docs::fromJson($item)),
            examples: IrHydration::optional($members, 'examples', static fn (mixed $item): array => IrHydration::listOf($item, 'OpaqueTypeUse.examples', static fn (mixed $item): mixed => IrHydration::copy($item))),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'reason'} = $this->reason;
        $json->{'origin'} = $this->origin->toJson();
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
