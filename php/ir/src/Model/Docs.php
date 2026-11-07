<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 6. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** Resolved documentation text. */
final readonly class Docs
{
    /**
     * @param string|null $summary
     * @param string|null $description
     */
    public function __construct(
        public ?string $summary = null,
        public ?string $description = null,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Docs');

        return new self(
            summary: IrHydration::optional($members, 'summary', static fn (mixed $item): string => IrHydration::string($item, 'Docs.summary')),
            description: IrHydration::optional($members, 'description', static fn (mixed $item): string => IrHydration::string($item, 'Docs.description')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        if ($this->summary !== null) {
            $json->{'summary'} = $this->summary;
        }
        if ($this->description !== null) {
            $json->{'description'} = $this->description;
        }
        return $json;
    }
}
