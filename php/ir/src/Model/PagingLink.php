<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PagingLink
{
    /**
     * @param string $rel
     * @param UrlRole $role
     */
    public function __construct(
        public string $rel,
        public UrlRole $role,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PagingLink');

        return new self(
            rel: IrHydration::string(IrHydration::required($members, 'rel', 'PagingLink'), 'PagingLink.rel'),
            role: UrlRole::fromJson(IrHydration::required($members, 'role', 'PagingLink')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'rel'} = $this->rel;
        $json->{'role'} = $this->role->toJson();
        return $json;
    }
}
