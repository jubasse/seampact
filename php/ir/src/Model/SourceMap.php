<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

final readonly class SourceMap
{
    /**
     * @param int $irRevision
     * @param array<int|string, SourceLocation> $locations Keyed by '<layer>#<pointer>', the serialised form of an Origin; a 'core' origin has no entry (ADR 0004 section 11).
     */
    public function __construct(
        public int $irRevision,
        public array $locations,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SourceMap');

        return new self(
            irRevision: IrHydration::integer(IrHydration::required($members, 'irRevision', 'SourceMap'), 'SourceMap.irRevision'),
            locations: IrHydration::mapOf(IrHydration::required($members, 'locations', 'SourceMap'), 'SourceMap.locations', static fn (mixed $item): SourceLocation => SourceLocation::fromJson($item)),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'irRevision'} = $this->irRevision;
        $json->{'locations'} = IrHydration::encodeMap($this->locations, static fn (SourceLocation $item): mixed => $item->toJson());
        return $json;
    }
}
