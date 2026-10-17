<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** An identity reached through credential schemes. */
final readonly class CredentialIdentity extends Identity
{
    /** The tag member 'kind': fixed to 'credential'. */
    public string $kind;

    /**
     * @param string $id
     * @param CredentialSchemes $schemes
     * @param Principal $principal
     * @param list<string> $errors
     * @param list<IdentityHeaderUse> $headers
     * @param Docs $docs
     * @param \stdClass $extensions
     * @param Origin $origin
     */
    public function __construct(
        public string $id,
        public CredentialSchemes $schemes,
        public Principal $principal,
        public array $errors,
        public array $headers,
        public Docs $docs,
        public \stdClass $extensions,
        public Origin $origin,
    ) {
        $this->kind = 'credential';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CredentialIdentity');
        IrHydration::tag($members, 'kind', 'credential', 'CredentialIdentity');

        return new self(
            id: IrHydration::string(IrHydration::required($members, 'id', 'CredentialIdentity'), 'CredentialIdentity.id'),
            schemes: CredentialSchemes::fromJson(IrHydration::required($members, 'schemes', 'CredentialIdentity')),
            principal: Principal::fromJson(IrHydration::required($members, 'principal', 'CredentialIdentity')),
            errors: IrHydration::listOf(IrHydration::required($members, 'errors', 'CredentialIdentity'), 'CredentialIdentity.errors', static fn (mixed $item): string => IrHydration::string($item, 'CredentialIdentity.errors[]')),
            headers: IrHydration::listOf(IrHydration::required($members, 'headers', 'CredentialIdentity'), 'CredentialIdentity.headers', static fn (mixed $item): IdentityHeaderUse => IdentityHeaderUse::fromJson($item)),
            docs: Docs::fromJson(IrHydration::required($members, 'docs', 'CredentialIdentity')),
            extensions: IrHydration::copyObject(IrHydration::object(IrHydration::required($members, 'extensions', 'CredentialIdentity'), 'CredentialIdentity.extensions')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'CredentialIdentity')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'id'} = $this->id;
        $json->{'kind'} = $this->kind;
        $json->{'schemes'} = $this->schemes->toJson();
        $json->{'principal'} = $this->principal->toJson();
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
