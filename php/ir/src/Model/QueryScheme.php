<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A credential in a query parameter. */
final readonly class QueryScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'query'. */
    public string $kind;

    /**
     * @param string $id
     * @param string $name The query parameter name.
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public string $name,
        public Origin $origin,
    ) {
        $this->kind = 'query';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'QueryScheme');
        IrHydration::tag($members, 'kind', 'query', 'QueryScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'QueryScheme'), 'QueryScheme.id'),
            name: IrHydration::string(IrHydration::required($members, 'name', 'QueryScheme'), 'QueryScheme.name'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'QueryScheme')),
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
