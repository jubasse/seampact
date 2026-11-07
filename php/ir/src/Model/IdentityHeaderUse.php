<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A use of the headers catalogue by an identity. */
final readonly class IdentityHeaderUse
{
    /**
     * @param string $header
     * @param HeaderUseFor $for
     * @param bool $required
     * @param Origin $origin
     * @param TypeUse|null $schema
     * @param ValueSource|null $from
     * @param string|null $stale
     */
    public function __construct(
        public string $header,
        public HeaderUseFor $for,
        public bool $required,
        public Origin $origin,
        public ?TypeUse $schema = null,
        public ?ValueSource $from = null,
        public ?string $stale = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'IdentityHeaderUse');

        return new self(
            header: IrHydration::string(IrHydration::required($members, 'header', 'IdentityHeaderUse'), 'IdentityHeaderUse.header'),
            for: HeaderUseFor::fromJson(IrHydration::required($members, 'for', 'IdentityHeaderUse')),
            required: IrHydration::boolean(IrHydration::required($members, 'required', 'IdentityHeaderUse'), 'IdentityHeaderUse.required'),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'IdentityHeaderUse')),
            schema: IrHydration::optional($members, 'schema', static fn (mixed $item): TypeUse => TypeUse::fromJson($item)),
            from: IrHydration::optional($members, 'from', static fn (mixed $item): ValueSource => ValueSource::fromJson($item)),
            stale: IrHydration::optional($members, 'stale', static fn (mixed $item): string => IrHydration::string($item, 'IdentityHeaderUse.stale')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'header'} = $this->header;
        $json->{'for'} = $this->for->toJson();
        $json->{'required'} = $this->required;
        if ($this->schema !== null) {
            $json->{'schema'} = $this->schema->toJson();
        }
        if ($this->from !== null) {
            $json->{'from'} = $this->from->toJson();
        }
        if ($this->stale !== null) {
            $json->{'stale'} = $this->stale;
        }
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
