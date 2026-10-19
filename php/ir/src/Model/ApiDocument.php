<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class ApiDocument
{
    /**
     * @param list<string> $surfaces
     * @param InternalPolicy $internal
     */
    public function __construct(
        public array $surfaces,
        public InternalPolicy $internal,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ApiDocument');

        return new self(
            surfaces: IrHydration::listOf(IrHydration::required($members, 'surfaces', 'ApiDocument'), 'ApiDocument.surfaces', static fn (mixed $item): string => IrHydration::string($item, 'ApiDocument.surfaces[]')),
            internal: InternalPolicy::fromJson(IrHydration::required($members, 'internal', 'ApiDocument')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'surfaces'} = $this->surfaces;
        $json->{'internal'} = $this->internal->toJson();
        return $json;
    }
}
