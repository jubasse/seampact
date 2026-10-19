<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class DerivedCsrf extends Csrf
{
    /** The tag member 'kind': fixed to 'derived'. */
    public string $kind;

    /**
     * @param string $header
     * @param DerivedFrom $derivedFrom
     */
    public function __construct(
        public string $header,
        public DerivedFrom $derivedFrom,
    ) {
        $this->kind = 'derived';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'DerivedCsrf');
        IrHydration::tag($members, 'kind', 'derived', 'DerivedCsrf');

        return new self(
            header: IrHydration::string(IrHydration::required($members, 'header', 'DerivedCsrf'), 'DerivedCsrf.header'),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'DerivedCsrf')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'header'} = $this->header;
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
