<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A signed request, verified as 'signature' says. */
final readonly class SignatureScheme extends Scheme
{
    /** The tag member 'kind': fixed to 'signature'. */
    public string $kind;

    /**
     * @param string $id
     * @param SignatureVerify $signature
     * @param Origin $origin
     * @param string|null $name The signature header.
     */
    public function __construct(
        public string $id,
        public SignatureVerify $signature,
        public Origin $origin,
        public ?string $name = null,
    ) {
        $this->kind = 'signature';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SignatureScheme');
        IrHydration::tag($members, 'kind', 'signature', 'SignatureScheme');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'SignatureScheme'), 'SignatureScheme.id'),
            signature: SignatureVerify::fromJson(IrHydration::required($members, 'signature', 'SignatureScheme')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'SignatureScheme')),
            name: IrHydration::optional($members, 'name', static fn (mixed $item): string => IrHydration::string($item, 'SignatureScheme.name')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        if ($this->name !== null) {
            $json->{'name'} = $this->name;
        }
        $json->{'signature'} = $this->signature->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
