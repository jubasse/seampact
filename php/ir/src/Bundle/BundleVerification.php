<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Model\ContractIR;

/**
 * The outcome of the pinned-bundle check: the manifest, the integrity and each api's IR by api name, or the
 * failures. `integrity` is the recomputed value once step 1 passed, the value to pin, even when a later step fails.
 */
final readonly class BundleVerification
{
    /**
     * @param array<string, ContractIR> $irs
     * @param list<BundleFailure> $failures
     */
    private function __construct(
        public bool $ok,
        public ?BundleManifest $manifest,
        public ?string $integrity,
        public array $irs,
        public array $failures,
    ) {
    }

    /** @param array<string, ContractIR> $irs */
    public static function verified(BundleManifest $manifest, string $integrity, array $irs): self
    {
        return new self(true, $manifest, $integrity, $irs, []);
    }

    /** @param list<BundleFailure> $failures */
    public static function refused(array $failures, ?string $integrity = null): self
    {
        return new self(false, null, $integrity, [], $failures);
    }
}
