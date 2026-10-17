<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SortKey
{
    /**
     * @param string $key
     * @param string|null $right
     * @param DerivedFrom|null $derivedFrom
     * @param Origin|null $origin
     */
    public function __construct(
        public string $key,
        public ?string $right = null,
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
        if ($this->derivedFrom !== null) {
            $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        }
        if ($this->origin !== null) {
            $json->{'origin'} = $this->origin->toJson();
        }
        return $json;
    }
}
