<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class HeaderUnionTag extends UnionTag
{
    /** The tag member 'in': fixed to 'header'. */
    public string $in;

    /**
     * @param string $name
     */
    public function __construct(
        public string $name,
    ) {
        $this->in = 'header';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'HeaderUnionTag');
        IrHydration::tag($members, 'in', 'header', 'HeaderUnionTag');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'HeaderUnionTag'), 'HeaderUnionTag.name'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'in'} = $this->in;
        $json->{'name'} = $this->name;
        return $json;
    }

    public function tag(): string
    {
        return $this->in;
    }
}
