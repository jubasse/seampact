<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class CallerCacheControl
{
    /**
     * @param CallerKind $caller
     * @param string $cacheControl
     */
    public function __construct(
        public CallerKind $caller,
        public string $cacheControl,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CallerCacheControl');

        return new self(
            caller: CallerKind::fromJson(IrHydration::required($members, 'caller', 'CallerCacheControl')),
            cacheControl: IrHydration::string(IrHydration::required($members, 'cacheControl', 'CallerCacheControl'), 'CallerCacheControl.cacheControl'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'caller'} = $this->caller->toJson();
        $json->{'cacheControl'} = $this->cacheControl;
        return $json;
    }
}
