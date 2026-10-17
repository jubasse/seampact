<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class PagingRequestRole
{
    /**
     * @param PagingRole $role
     * @param PagingParamPlacement $in
     * @param string $name
     * @param int|null $base
     * @param PagingParamStyle|null $style
     * @param string|null $direction With style 'split': the direction parameter's name.
     */
    public function __construct(
        public PagingRole $role,
        public PagingParamPlacement $in,
        public string $name,
        public ?int $base = null,
        public ?PagingParamStyle $style = null,
        public ?string $direction = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'PagingRequestRole');

        return new self(
            role: PagingRole::fromJson(IrHydration::required($members, 'role', 'PagingRequestRole')),
            in: PagingParamPlacement::fromJson(IrHydration::required($members, 'in', 'PagingRequestRole')),
            name: IrHydration::string(IrHydration::required($members, 'name', 'PagingRequestRole'), 'PagingRequestRole.name'),
            base: IrHydration::optional($members, 'base', static fn (mixed $item): int => IrHydration::integer($item, 'PagingRequestRole.base')),
            style: IrHydration::optional($members, 'style', static fn (mixed $item): PagingParamStyle => PagingParamStyle::fromJson($item)),
            direction: IrHydration::optional($members, 'direction', static fn (mixed $item): string => IrHydration::string($item, 'PagingRequestRole.direction')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'role'} = $this->role->toJson();
        $json->{'in'} = $this->in->toJson();
        $json->{'name'} = $this->name;
        if ($this->base !== null) {
            $json->{'base'} = $this->base;
        }
        if ($this->style !== null) {
            $json->{'style'} = $this->style->toJson();
        }
        if ($this->direction !== null) {
            $json->{'direction'} = $this->direction;
        }
        return $json;
    }
}
