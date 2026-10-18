<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A bearer token in the Authorization header. */
final readonly class BearerScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'bearer'. */
    public string $kind;

    /**
     * @param string $id
     * @param Origin $origin
     * @param BearerFacts|null $bearer
     */
    public function __construct(
        public string $id,
        public Origin $origin,
        public ?BearerFacts $bearer = null,
    ) {
        $this->kind = 'bearer';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'BearerScheme');
        IrHydration::tag($members, 'kind', 'bearer', 'BearerScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'BearerScheme'), 'BearerScheme.id'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'BearerScheme')),
            bearer: IrHydration::optional($members, 'bearer', static fn (mixed $item): BearerFacts => BearerFacts::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        if ($this->bearer !== null) {
            $json->{'bearer'} = $this->bearer->toJson();
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
