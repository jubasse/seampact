<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class DerivedIdempotency extends Idempotency
{
    /** The tag member 'kind': fixed to 'derived'. */
    public string $kind;

    /**
     * @param string $header
     * @param string $replayHeader
     * @param int $lifetimeMs
     * @param bool $required
     * @param IdempotencyEnforcement $enforce
     * @param DerivedFrom $derivedFrom
     */
    public function __construct(
        public string $header,
        public string $replayHeader,
        public int $lifetimeMs,
        public bool $required,
        public IdempotencyEnforcement $enforce,
        public DerivedFrom $derivedFrom,
    ) {
        $this->kind = 'derived';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'DerivedIdempotency');
        IrHydration::tag($members, 'kind', 'derived', 'DerivedIdempotency');

        return new self(
            header: IrHydration::string(IrHydration::required($members, 'header', 'DerivedIdempotency'), 'DerivedIdempotency.header'),
            replayHeader: IrHydration::string(IrHydration::required($members, 'replayHeader', 'DerivedIdempotency'), 'DerivedIdempotency.replayHeader'),
            lifetimeMs: IrHydration::integer(IrHydration::required($members, 'lifetimeMs', 'DerivedIdempotency'), 'DerivedIdempotency.lifetimeMs'),
            required: IrHydration::boolean(IrHydration::required($members, 'required', 'DerivedIdempotency'), 'DerivedIdempotency.required'),
            enforce: IdempotencyEnforcement::fromJson(IrHydration::required($members, 'enforce', 'DerivedIdempotency')),
            derivedFrom: DerivedFrom::fromJson(IrHydration::required($members, 'derivedFrom', 'DerivedIdempotency')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'header'} = $this->header;
        $json->{'replayHeader'} = $this->replayHeader;
        $json->{'lifetimeMs'} = $this->lifetimeMs;
        $json->{'required'} = $this->required;
        $json->{'enforce'} = $this->enforce->toJson();
        $json->{'derivedFrom'} = $this->derivedFrom->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
