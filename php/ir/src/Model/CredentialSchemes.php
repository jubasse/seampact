<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** The schemes of a credential identity. */
final readonly class CredentialSchemes
{
    /**
     * @param list<string> $read
     * @param list<string> $write Empty when the identity is refused on writes.
     * @param list<string> $optionalRead
     */
    public function __construct(
        public array $read,
        public array $write,
        public array $optionalRead,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'CredentialSchemes');

        return new self(
            read: IrHydration::listOf(IrHydration::required($members, 'read', 'CredentialSchemes'), 'CredentialSchemes.read', static fn (mixed $item): string => IrHydration::string($item, 'CredentialSchemes.read[]')),
            write: IrHydration::listOf(IrHydration::required($members, 'write', 'CredentialSchemes'), 'CredentialSchemes.write', static fn (mixed $item): string => IrHydration::string($item, 'CredentialSchemes.write[]')),
            optionalRead: IrHydration::listOf(IrHydration::required($members, 'optionalRead', 'CredentialSchemes'), 'CredentialSchemes.optionalRead', static fn (mixed $item): string => IrHydration::string($item, 'CredentialSchemes.optionalRead[]')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'read'} = $this->read;
        $json->{'write'} = $this->write;
        $json->{'optionalRead'} = $this->optionalRead;
        return $json;
    }
}
