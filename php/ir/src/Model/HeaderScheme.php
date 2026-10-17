<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A credential in a request header. */
final readonly class HeaderScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'header'. */
    public string $kind;

    /**
     * @param string $id
     * @param string $name The header name.
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public string $name,
        public Origin $origin,
    ) {
        $this->kind = 'header';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'HeaderScheme');
        IrHydration::tag($members, 'kind', 'header', 'HeaderScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'HeaderScheme'), 'HeaderScheme.id'),
            name: IrHydration::string(IrHydration::required($members, 'name', 'HeaderScheme'), 'HeaderScheme.name'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'HeaderScheme')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        $json->{'name'} = $this->name;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
