<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class RuleRequirement extends Requirement
{
    /** The tag member 'kind': fixed to 'rule'. */
    public string $kind;

    /**
     * @param string $rule
     * @param IrOpaque|null $params Values already validated against the rule's params schema.
     * @param string|null $bucket
     * @param string|null $entry The 'requirements' entry it was written through.
     * @param Origin|null $origin
     * @param DerivedFrom|null $derivedFrom
     */
    public function __construct(
        public string $rule,
        public ?IrOpaque $params = null,
        public ?string $bucket = null,
        public ?string $entry = null,
        public ?Origin $origin = null,
        public ?DerivedFrom $derivedFrom = null,
    ) {
        $this->kind = 'rule';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'RuleRequirement');
        IrHydration::tag($members, 'kind', 'rule', 'RuleRequirement');

        return new self(
            rule: IrHydration::string(IrHydration::required($members, 'rule', 'RuleRequirement'), 'RuleRequirement.rule'),
            params: IrHydration::optionalOpaque($members, 'params'),
            bucket: IrHydration::optional($members, 'bucket', static fn (mixed $item): string => IrHydration::string($item, 'RuleRequirement.bucket')),
            entry: IrHydration::optional($members, 'entry', static fn (mixed $item): string => IrHydration::string($item, 'RuleRequirement.entry')),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'rule'} = $this->rule;
        if ($this->params !== null) {
            $json->{'params'} = IrHydration::copy($this->params->value());
        }
        if ($this->bucket !== null) {
            $json->{'bucket'} = $this->bucket;
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
