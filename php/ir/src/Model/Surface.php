<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class Surface
{
    /**
     * @param Name $name
     * @param string $prefix
     * @param PathVersionMode $pathVersion
     * @param Origin $origin
     */
    public function __construct(
        public Name $name,
        public string $prefix,
        public PathVersionMode $pathVersion,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Surface');

        return new self(
            name: Name::fromJson(IrHydration::required($members, 'name', 'Surface')),
            prefix: IrHydration::string(IrHydration::required($members, 'prefix', 'Surface'), 'Surface.prefix'),
            pathVersion: PathVersionMode::fromJson(IrHydration::required($members, 'pathVersion', 'Surface')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'Surface')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'name'} = $this->name->toJson();
        $json->{'prefix'} = $this->prefix;
        $json->{'pathVersion'} = $this->pathVersion->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
