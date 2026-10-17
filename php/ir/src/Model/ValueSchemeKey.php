<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ValueSchemeKey extends SchemeKey
{
    /** The tag member 'kind': fixed to 'value'. */
    public string $kind;

    /**
     * @param string $value The key id the application looks its secret up by; never the secret.
     */
    public function __construct(
        public string $value,
    ) {
        $this->kind = 'value';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ValueSchemeKey');
        IrHydration::tag($members, 'kind', 'value', 'ValueSchemeKey');

        return new self(
            value: IrHydration::string(IrHydration::required($members, 'value', 'ValueSchemeKey'), 'ValueSchemeKey.value'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'value'} = $this->value;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
