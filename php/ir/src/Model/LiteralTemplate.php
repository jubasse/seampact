<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class LiteralTemplate extends Template
{
    /** The tag member 'kind': fixed to 'literal'. */
    public string $kind;

    /**
     * @param mixed $value
     */
    public function __construct(
        public mixed $value,
    ) {
        $this->kind = 'literal';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'LiteralTemplate');
        IrHydration::tag($members, 'kind', 'literal', 'LiteralTemplate');

        return new self(
            value: IrHydration::copy(IrHydration::required($members, 'value', 'LiteralTemplate')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'value'} = IrHydration::copy($this->value);
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
