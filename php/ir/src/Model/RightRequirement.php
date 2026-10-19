<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RightRequirement extends Requirement
{
    /** The tag member 'kind': fixed to 'right'. */
    public string $kind;

    /**
     * @param string $right
     * @param IrOpaque|null $params Values already validated against the right's params schema.
     * @param RequirementSubject|null $subject
     * @param string|null $entry The 'requirements' entry it was written through.
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $right,
        public ?IrOpaque $params = null,
        public ?RequirementSubject $subject = null,
        public ?string $entry = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
        $this->kind = 'right';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RightRequirement');
        IrHydration::tag($members, 'kind', 'right', 'RightRequirement');

        return new self(
            right: IrHydration::string(IrHydration::required($members, 'right', 'RightRequirement'), 'RightRequirement.right'),
            params: IrHydration::optionalOpaque($members, 'params'),
            subject: IrHydration::optional($members, 'subject', static fn (mixed $item): RequirementSubject => RequirementSubject::fromJson($item)),
            entry: IrHydration::optional($members, 'entry', static fn (mixed $item): string => IrHydration::string($item, 'RightRequirement.entry')),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'right'} = $this->right;
        if ($this->params !== null) {
            $json->{'params'} = IrHydration::copy($this->params->value());
        }
        if ($this->subject !== null) {
            $json->{'subject'} = $this->subject->toJson();
        }
        if ($this->entry !== null) {
            $json->{'entry'} = $this->entry;
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
