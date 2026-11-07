<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

use Seampact\Ir\Model\IrModelVersion;

/**
 * What a reader declares it reads (ADR 0005 sections 2 and 3), mirroring `IrSupport` of `@seampact/spec/ir`:
 * the `irVersion` values, the exact `irRevision`, and the declaration kinds and must-understand features.
 */
final readonly class IrSupport
{
    /**
     * @param list<int> $irVersions
     * @param list<string> $kinds
     * @param list<string> $features
     */
    public function __construct(
        public array $irVersions,
        public int $irRevision,
        public array $kinds,
        public array $features,
    ) {
    }

    /**
     * The support of this model: its own version and revision, the given kinds and features.
     *
     * @param list<string> $kinds
     * @param list<string> $features
     */
    public static function ofModel(array $kinds, array $features = []): self
    {
        return new self([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, $kinds, $features);
    }
}
