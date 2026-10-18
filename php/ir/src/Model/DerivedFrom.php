<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Present on, and only on, an element the compiler derived (ADR 0004 section 6). */
final readonly class DerivedFrom
{
    /**
     * @param string $derivation
     * @param list<Origin> $from
     */
    public function __construct(
        public string $derivation,
        public array $from,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'DerivedFrom');

        return new self(
            derivation: IrHydration::string(IrHydration::required($members, 'derivation', 'DerivedFrom'), 'DerivedFrom.derivation'),
            from: IrHydration::listOf(IrHydration::required($members, 'from', 'DerivedFrom'), 'DerivedFrom.from', static fn (mixed $item): Origin => Origin::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'derivation'} = $this->derivation;
        $json->{'from'} = IrHydration::encodeList($this->from, static fn (Origin $item): mixed => $item->toJson());
        return $json;
    }
}
