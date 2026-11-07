<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A role this code answers on the operation and the template filling its params from the role's data (ADR 0006 section 6). */
final readonly class ErrorRoleBinding
{
    /**
     * @param ErrorRole $role
     * @param Template|null $params Present if and only if the code declares params (invariant ir.error.role-params).
     */
    public function __construct(
        public ErrorRole $role,
        public ?Template $params = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'ErrorRoleBinding');

        return new self(
            role: ErrorRole::fromJson(IrHydration::required($members, 'role', 'ErrorRoleBinding')),
            params: IrHydration::optional($members, 'params', static fn (mixed $item): Template => Template::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'role'} = $this->role->toJson();
        if ($this->params !== null) {
            $json->{'params'} = $this->params->toJson();
        }
        return $json;
    }
}
