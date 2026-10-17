<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 3. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class VariantsPrincipal extends Principal
{
    /** The tag member 'kind': fixed to 'variants'. */
    public string $kind;

    /**
     * @param array<int|string, string> $variants
     */
    public function __construct(
        public array $variants,
    ) {
        $this->kind = 'variants';
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'VariantsPrincipal');
        IrHydration::tag($members, 'kind', 'variants', 'VariantsPrincipal');

        return new self(
            variants: IrHydration::mapOf(IrHydration::required($members, 'variants', 'VariantsPrincipal'), 'VariantsPrincipal.variants', static fn (mixed $item): string => IrHydration::string($item, 'VariantsPrincipal.variants{}')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'kind'} = $this->kind;
        $json->{'variants'} = IrHydration::encodeMap($this->variants);
        return $json;
    }

    public function tag(): string
    {
        return $this->kind;
    }
}
