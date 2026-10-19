<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ObjectTemplateMember
{
    /**
     * @param MemberName $name
     * @param Template $value
     */
    public function __construct(
        public MemberName $name,
        public Template $value,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ObjectTemplateMember');

        return new self(
            name: MemberName::fromJson(IrHydration::required($members, 'name', 'ObjectTemplateMember')),
            value: Template::fromJson(IrHydration::required($members, 'value', 'ObjectTemplateMember')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name->toJson();
        $json->{'value'} = $this->value->toJson();
        return $json;
    }
}
