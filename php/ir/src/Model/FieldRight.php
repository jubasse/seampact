<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A field right, materialised so targets never walk schemas (FR-23). */
final readonly class FieldRight
{
    /**
     * @param string $schema
     * @param string $pointer
     * @param string $right
     * @param Direction $direction
     * @param DerivedFrom $derivedFrom
     * @param IrOpaque|null $params
     * @param FieldRightSubject|null $subject
     * @param InputPolicy|null $inputPolicy
     */
    public function __construct(
        public string $schema,
        public string $pointer,
        public string $right,
        public Direction $direction,
        public DerivedFrom $derivedFrom,
        public ?IrOpaque $params = null,
        public ?FieldRightSubject $subject = null,
        public ?InputPolicy $inputPolicy = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'FieldRight');

        return new self(
            schema: IrHydration::string(IrHydration::required($members, 'schema', 'FieldRight'), 'FieldRight.schema'),
            pointer: IrHydration::string(IrHydration::required($members, 'pointer', 'FieldRight'), 'FieldRight.pointer'),
            right: IrHydration::string(IrHydration::required($members, 'right', 'FieldRight'), 'FieldRight.right'),
            direction: Direction::fromJson(IrHydration::required($members, 'direction', 'FieldRight')),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'FieldRight')),
            params: IrHydration::optionalOpaque($members, 'params'),
            subject: IrHydration::optional($members, 'subject', static fn (mixed $item): FieldRightSubject => FieldRightSubject::fromJson($item)),
            inputPolicy: IrHydration::optional($members, 'inputPolicy', static fn (mixed $item): InputPolicy => InputPolicy::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'schema'} = $this->schema;
        $json->{'pointer'} = $this->pointer;
        $json->{'right'} = $this->right;
        if ($this->params !== null) {
            $json->{'params'} = IrHydration::copy($this->params->value);
        }
        if ($this->subject !== null) {
            $json->{'subject'} = $this->subject->toJson();
        }
        $json->{'direction'} = $this->direction->toJson();
        if ($this->inputPolicy !== null) {
            $json->{'inputPolicy'} = $this->inputPolicy->toJson();
        }
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }
}
