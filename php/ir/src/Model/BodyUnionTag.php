<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class BodyUnionTag extends UnionTag
{
    /** The tag member 'in': fixed to 'body'. */
    public string $in;

    /**
     * @param string $property
     */
    public function __construct(
        public string $property,
    ) {
        $this->in = 'body';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'BodyUnionTag');
        IrHydration::tag($members, 'in', 'body', 'BodyUnionTag');

        return new self(
            property: IrHydration::string(IrHydration::required($members, 'property', 'BodyUnionTag'), 'BodyUnionTag.property'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'in'} = $this->in;
        $json->{'property'} = $this->property;
        return $json;
    }

    public function tag(): string
    {
        return $this->in;
    }
}
