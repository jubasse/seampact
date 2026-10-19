<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class OptionalAccess extends Access
{
    /** The tag member 'kind': fixed to 'optional'. */
    public string $kind;

    /**
     * @param string $identity
     * @param list<string> $schemes
     * @param string $reason
     * @param RefusedCredential $onRefused
     * @param Origin $origin
     */
    public function __construct(
        public string $identity,
        public array $schemes,
        public string $reason,
        public RefusedCredential $onRefused,
        public Origin $origin,
    ) {
        $this->kind = 'optional';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'OptionalAccess');
        IrHydration::tag($members, 'kind', 'optional', 'OptionalAccess');

        return new self(
            identity: IrHydration::string(IrHydration::required($members, 'identity', 'OptionalAccess'), 'OptionalAccess.identity'),
            schemes: IrHydration::listOf(IrHydration::required($members, 'schemes', 'OptionalAccess'), 'OptionalAccess.schemes', static fn (mixed $item): string => IrHydration::string($item, 'OptionalAccess.schemes[]')),
            reason: IrHydration::string(IrHydration::required($members, 'reason', 'OptionalAccess'), 'OptionalAccess.reason'),
            onRefused: RefusedCredential::fromJson(IrHydration::required($members, 'onRefused', 'OptionalAccess')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'OptionalAccess')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'identity'} = $this->identity;
        $json->{'schemes'} = $this->schemes;
        $json->{'reason'} = $this->reason;
        $json->{'onRefused'} = $this->onRefused->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
