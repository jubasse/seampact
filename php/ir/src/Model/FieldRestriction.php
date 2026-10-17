<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A restrictedTo mark (ADR 0003 section 6). */
final readonly class FieldRestriction
{
    /**
     * @param string $right
     * @param IrOpaque|null $params
     * @param InputPolicy|null $inputPolicy
     * @param Origin|null $origin
     */
    public function __construct(
        public string $right,
        public ?IrOpaque $params = null,
        public ?InputPolicy $inputPolicy = null,
        public ?Origin $origin = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'FieldRestriction');

        return new self(
            right: IrHydration::string(IrHydration::required($members, 'right', 'FieldRestriction'), 'FieldRestriction.right'),
            params: IrHydration::optionalOpaque($members, 'params'),
            inputPolicy: IrHydration::optional($members, 'inputPolicy', static fn (mixed $item): InputPolicy => InputPolicy::fromJson($item)),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'right'} = $this->right;
        if ($this->params !== null) {
            $json->{'params'} = IrHydration::copy($this->params->value());
        }
        if ($this->inputPolicy !== null) {
            $json->{'inputPolicy'} = $this->inputPolicy->toJson();
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        return $json;
    }
}
