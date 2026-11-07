<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class IdentityAccess extends Access
{
    /** The tag member 'kind': fixed to 'identity'. */
    public string $kind;

    /**
     * @param string $identity
     * @param list<string> $schemes
     * @param Origin $origin
     */
    public function __construct(
        public string $identity,
        public array $schemes,
        public Origin $origin,
    ) {
        $this->kind = 'identity';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'IdentityAccess');
        IrHydration::tag($members, 'kind', 'identity', 'IdentityAccess');

        return new self(
            identity: IrHydration::string(IrHydration::required($members, 'identity', 'IdentityAccess'), 'IdentityAccess.identity'),
            schemes: IrHydration::listOf(IrHydration::required($members, 'schemes', 'IdentityAccess'), 'IdentityAccess.schemes', static fn (mixed $item): string => IrHydration::string($item, 'IdentityAccess.schemes[]')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'IdentityAccess')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'identity'} = $this->identity;
        $json->{'schemes'} = $this->schemes;
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
