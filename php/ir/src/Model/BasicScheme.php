<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** HTTP basic credentials in the Authorization header. */
final readonly class BasicScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'basic'. */
    public string $kind;

    /**
     * @param string $id
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public Origin $origin,
    ) {
        $this->kind = 'basic';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'BasicScheme');
        IrHydration::tag($members, 'kind', 'basic', 'BasicScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'BasicScheme'), 'BasicScheme.id'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'BasicScheme')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
