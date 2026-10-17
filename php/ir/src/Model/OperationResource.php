<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The collection or single it belongs to. */
final readonly class OperationResource
{
    /**
     * @param string $type
     * @param string|null $idParam
     * @param string|null $idProperty
     */
    public function __construct(
        public string $type,
        public ?string $idParam = null,
        public ?string $idProperty = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationResource');

        return new self(
            type: IrHydration::string(IrHydration::required($members, 'type', 'OperationResource'), 'OperationResource.type'),
            idParam: IrHydration::optional($members, 'idParam', static fn (mixed $item): string => IrHydration::string($item, 'OperationResource.idParam')),
            idProperty: IrHydration::optional($members, 'idProperty', static fn (mixed $item): string => IrHydration::string($item, 'OperationResource.idProperty')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'type'} = $this->type;
        if ($this->idParam !== null) {
            $json->{'idParam'} = $this->idParam;
        }
        if ($this->idProperty !== null) {
            $json->{'idProperty'} = $this->idProperty;
        }
        return $json;
    }
}
