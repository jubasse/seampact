<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class EnumNarrowing
{
    /**
     * @param list<string> $values
     * @param string|null $reason
     */
    public function __construct(
        public array $values,
        public ?string $reason = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'EnumNarrowing');

        return new self(
            values: IrHydration::listOf(IrHydration::required($members, 'values', 'EnumNarrowing'), 'EnumNarrowing.values', static fn (mixed $item): string => IrHydration::string($item, 'EnumNarrowing.values[]')),
            reason: IrHydration::optional($members, 'reason', static fn (mixed $item): string => IrHydration::string($item, 'EnumNarrowing.reason')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'values'} = $this->values;
        if ($this->reason !== null) {
            $json->{'reason'} = $this->reason;
        }
        return $json;
    }
}
