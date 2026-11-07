<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A kind-tagged operation reference (ADR 0014). */
final readonly class OperationRef
{
    /**
     * @param DeclarationKind $kind
     * @param string $api
     * @param string $id
     */
    public function __construct(
        public DeclarationKind $kind,
        public string $api,
        public string $id,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OperationRef');

        return new self(
            kind: DeclarationKind::fromJson(IrHydration::required($members, 'kind', 'OperationRef')),
            api: IrHydration::string(IrHydration::required($members, 'api', 'OperationRef'), 'OperationRef.api'),
            id: IrHydration::string(IrHydration::required($members, 'id', 'OperationRef'), 'OperationRef.id'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind->toJson();
        $json->{'api'} = $this->api;
        $json->{'id'} = $this->id;
        return $json;
    }
}
