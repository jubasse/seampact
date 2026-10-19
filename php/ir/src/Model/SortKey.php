<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SortKey
{
    /**
     * @param string $key
     * @param string|null $right
     * @param IrOpaque|null $params The params of 'right', validated against the right's params schema; only with 'right' (ADR 0002 section 10).
     * @param FieldRightSubject|null $subject Where the right's subject is read on the request; only with 'right' (ADR 0003 section 6).
     * @param DerivedFrom|null $derivedFrom
     * @param Origin|null $origin
     */
    public function __construct(
        public string $key,
        public ?string $right = null,
        public ?IrOpaque $params = null,
        public ?FieldRightSubject $subject = null,
        public ?DerivedFrom $derivedFrom = null,
        public ?Origin $origin = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SortKey');

        return new self(
            key: IrHydration::string(IrHydration::required($members, 'key', 'SortKey'), 'SortKey.key'),
            right: IrHydration::optional($members, 'right', static fn (mixed $item): string => IrHydration::string($item, 'SortKey.right')),
            params: IrHydration::optionalOpaque($members, 'params'),
            subject: IrHydration::optional($members, 'subject', static fn (mixed $item): FieldRightSubject => FieldRightSubject::fromJson($item)),
            derivedFrom: IrHydration::optional($members, 'derivedFrom', static fn (mixed $item): DerivedFrom => DerivedFrom::fromJson($item)),
            origin: IrHydration::optional($members, 'origin', static fn (mixed $item): Origin => Origin::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'key'} = $this->key;
        if ($this->right !== null) {
            $json->{'right'} = $this->right;
        }
        if ($this->params !== null) {
            $json->{'params'} = IrHydration::copy($this->params->value());
        }
        if ($this->subject !== null) {
            $json->{'subject'} = $this->subject->toJson();
        }
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        return $json;
    }
}
