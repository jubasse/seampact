<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class EachTemplate extends Template
{
    /** The tag member 'kind': fixed to 'each'. */
    public string $kind;

    /**
     * @param string $of
     * @param Template $as
     */
    public function __construct(
        public string $of,
        public Template $as,
    ) {
        $this->kind = 'each';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'EachTemplate');
        IrHydration::tag($members, 'kind', 'each', 'EachTemplate');

        return new self(
            of: IrHydration::string(IrHydration::required($members, 'of', 'EachTemplate'), 'EachTemplate.of'),
            as: Template::fromJson(IrHydration::required($members, 'as', 'EachTemplate')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'of'} = $this->of;
        $json->{'as'} = $this->as->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
