<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class OperationScope
{
    /**
     * @param string $scope
     * @param ValueSource $source Where the scope id is read; 'in: resolver' for an application resolver.
     * @param Origin $origin
     */
    public function __construct(
        public string $scope,
        public ValueSource $source,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationScope');

        return new self(
            scope: IrHydration::string(IrHydration::required($members, 'scope', 'OperationScope'), 'OperationScope.scope'),
            source: ValueSource::fromJson(IrHydration::required($members, 'source', 'OperationScope')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OperationScope')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'scope'} = $this->scope;
        $json->{'source'} = $this->source->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
