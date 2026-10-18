<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Where a value is read (ADR 0004 section 7). 'name' with path, query, header, body, principal, scope and holderField (the holder's property); no other member with host, subdomain and resolver; 'prefixBits' only with address (invariants ir.value-source.members and ir.value-source.place). */
final readonly class ValueSource
{
    /**
     * @param ValueSourceIn $in
     * @param string|null $name
     * @param int|null $prefixBits
     */
    public function __construct(
        public ValueSourceIn $in,
        public ?string $name = null,
        public ?int $prefixBits = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ValueSource');

        return new self(
            in: ValueSourceIn::fromJson(IrHydration::required($members, 'in', 'ValueSource')),
            name: IrHydration::optional($members, 'name', static fn (mixed $item): string => IrHydration::string($item, 'ValueSource.name')),
            prefixBits: IrHydration::optional($members, 'prefixBits', static fn (mixed $item): int => IrHydration::integer($item, 'ValueSource.prefixBits')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'in'} = $this->in->toJson();
        if ($this->name !== null) {
            $json->{'name'} = $this->name;
        }
        if ($this->prefixBits !== null) {
            $json->{'prefixBits'} = $this->prefixBits;
        }
        return $json;
    }
}
