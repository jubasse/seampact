<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An identity reached through one signature scheme (ADR 0013). */
final readonly class SignedIdentity extends Identity
{
    /** The tag member 'kind': fixed to 'signed'. */
    public string $kind;

    private \stdClass $extensions;

    /**
     * @param string $id
     * @param string $signed
     * @param Principal $principal
     * @param list<string> $errors
     * @param list<IdentityHeaderUse> $headers
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     * @param KeysPolicy|null $unknownKeys
     */
    public function __construct(
        public string $id,
        public string $signed,
        public Principal $principal,
        public array $errors,
        public array $headers,
        public Docs $docs,
        \stdClass $extensions,
        public Origin $origin,
        public ?KeysPolicy $unknownKeys = null,
    ) {
        $this->kind = 'signed';
        $this->extensions = IrHydration::copyObject($extensions);
    }

    public function extensions(): \stdClass
    {
        return IrHydration::copyObject($this->extensions);
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SignedIdentity');
        IrHydration::tag($members, 'kind', 'signed', 'SignedIdentity');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'SignedIdentity'), 'SignedIdentity.id'),
            signed: IrHydration::string(IrHydration::required($members, 'signed', 'SignedIdentity'), 'SignedIdentity.signed'),
            principal: Principal::fromJson(IrHydration::required($members, 'principal', 'SignedIdentity')),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'SignedIdentity'), 'SignedIdentity.errors', static fn (mixed $item): string => IrHydration::string($item, 'SignedIdentity.errors[]')),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'SignedIdentity'), 'SignedIdentity.headers', static fn (mixed $item): IdentityHeaderUse => IdentityHeaderUse::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'SignedIdentity')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'SignedIdentity'), 'SignedIdentity.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'SignedIdentity')),
            unknownKeys: IrHydration::optional($members, 'unknownKeys', static fn (mixed $item): KeysPolicy => KeysPolicy::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        $json->{'signed'} = $this->signed;
        $json->{'principal'} = $this->principal->toJson();
        if ($this->unknownKeys !== null) {
            $json->{'unknownKeys'} = $this->unknownKeys->toJson();
        }
        $json->{'errors'} = $this->errors;
        $json->{'headers'} = IrHydration::encodeList($this->headers, static fn (IdentityHeaderUse $item): mixed => $item->toJson());
        $json->{'docs'} = $this->docs->toJson();
        $json->{'extensions'} = IrHydration::copy($this->extensions);
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
