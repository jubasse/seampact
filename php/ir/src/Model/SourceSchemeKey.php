<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SourceSchemeKey extends SchemeKey
{
    /** The tag member 'kind': fixed to 'from'. */
    public string $kind;

    /**
     * @param ValueSource $from Where the request carries the key id (path, query or header).
     */
    public function __construct(
        public ValueSource $from,
    ) {
        $this->kind = 'from';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SourceSchemeKey');
        IrHydration::tag($members, 'kind', 'from', 'SourceSchemeKey');

        return new self(
            from: ValueSource::fromJson(IrHydration::required($members, 'from', 'SourceSchemeKey')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'from'} = $this->from->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
