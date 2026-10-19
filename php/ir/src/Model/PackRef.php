<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 5. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A pack applied, in application order. */
final readonly class PackRef
{
    /**
     * @param string $name
     * @param string $version
     */
    public function __construct(
        public string $name,
        public string $version,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PackRef');

        return new self(
            name: IrHydration::string(IrHydration::required($members, 'name', 'PackRef'), 'PackRef.name'),
            version: IrHydration::string(IrHydration::required($members, 'version', 'PackRef'), 'PackRef.version'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name;
        $json->{'version'} = $this->version;
        return $json;
    }
}
