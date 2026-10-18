<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A pattern refinement: the written text and its normalised form (ADR 0003 section 9). */
final readonly class Pattern
{
    /**
     * @param string $source
     * @param string $normalized
     */
    public function __construct(
        public string $source,
        public string $normalized,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'Pattern');

        return new self(
            source: IrHydration::string(IrHydration::required($members, 'source', 'Pattern'), 'Pattern.source'),
            normalized: IrHydration::string(IrHydration::required($members, 'normalized', 'Pattern'), 'Pattern.normalized'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'source'} = $this->source;
        $json->{'normalized'} = $this->normalized;
        return $json;
    }
}
