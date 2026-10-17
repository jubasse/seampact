<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A canonical name: word segments plus a role, never a final identifier (ADR 0007 section 1 and its amendment). */
final readonly class Name
{
    /**
     * @param list<string> $segments
     * @param NameRole $role
     * @param int|null $status The HTTP success or redirect status of a 'response' name; present if and only if role is 'response' (invariant ir.name.status, ADR 0004 section 13).
     */
    public function __construct(
        public array $segments,
        public NameRole $role,
        public ?int $status = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Name');

        return new self(
            segments: IrHydration::listOf(IrHydration::required($members, 'segments', 'Name'), 'Name.segments', static fn (mixed $item): string => IrHydration::string($item, 'Name.segments[]')),
            role: NameRole::fromJson(IrHydration::required($members, 'role', 'Name')),
            status: IrHydration::optional($members, 'status', static fn (mixed $item): int => IrHydration::integer($item, 'Name.status')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'segments'} = $this->segments;
        $json->{'role'} = $this->role->toJson();
        if ($this->status !== null) {
            $json->{'status'} = $this->status;
        }
        return $json;
    }
}
