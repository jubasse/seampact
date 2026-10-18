<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 4. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A resolved lint severity. */
final readonly class LintRule
{
    /**
     * @param LintSeverity $severity
     * @param Origin $origin
     */
    public function __construct(
        public LintSeverity $severity,
        public Origin $origin,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'LintRule');

        return new self(
            severity: LintSeverity::fromJson(IrHydration::required($members, 'severity', 'LintRule')),
            origin: Origin::fromJson(IrHydration::required($members, 'origin', 'LintRule')),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'severity'} = $this->severity->toJson();
        $json->{'origin'} = $this->origin->toJson();
        return $json;
    }
}
