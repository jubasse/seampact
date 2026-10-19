<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PlainMemberName extends MemberName
{
    /** The tag member 'kind': fixed to 'text'. */
    public string $kind;

    /**
     * @param string $text
     */
    public function __construct(
        public string $text,
    ) {
        $this->kind = 'text';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PlainMemberName');
        IrHydration::tag($members, 'kind', 'text', 'PlainMemberName');

        return new self(
            text: IrHydration::string(IrHydration::required($members, 'text', 'PlainMemberName'), 'PlainMemberName.text'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'text'} = $this->text;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
