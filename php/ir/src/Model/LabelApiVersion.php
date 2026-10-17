<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class LabelApiVersion extends ApiVersion
{
    /** The tag member 'kind': fixed to 'label'. */
    public string $kind;

    /**
     * @param string $label
     */
    public function __construct(
        public string $label,
    ) {
        $this->kind = 'label';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'LabelApiVersion');
        IrHydration::tag($members, 'kind', 'label', 'LabelApiVersion');

        return new self(
            label: IrHydration::string(IrHydration::required($members, 'label', 'LabelApiVersion'), 'LabelApiVersion.label'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'label'} = $this->label;
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
