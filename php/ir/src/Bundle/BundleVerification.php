<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

use Seampact\Ir\Model\ContractIR;

/**
 * The outcome of the pinned-bundle check: the manifest, the integrity, each api's IR and the IR bytes the check
 * read, by api name, or the failures. A reader uses those bytes, never the file again, so what it reads is what
 * passed. `integrity` is the recomputed value once step 1 passed, the value to pin, even when a later step fails.
 */
final readonly class BundleVerification
{
    /**
     * @param array<string, ContractIR> $irs
     * @param array<string, string> $irBytes
     * @param list<BundleFailure> $failures
     */
    private function __construct(
        public bool $ok,
        public ?BundleManifest $manifest,
        public ?string $integrity,
        public array $irs,
        public array $irBytes,
        public array $failures,
    ) {
    }

    /**
     * @param array<string, ContractIR> $irs
     * @param array<string, string> $irBytes
     */
    public static function verified(BundleManifest $manifest, string $integrity, array $irs, array $irBytes): self
    {
        return new self(true, $manifest, $integrity, $irs, $irBytes, []);
    }

    /** @param list<BundleFailure> $failures */
    public static function refused(array $failures, ?string $integrity = null): self
    {
        return new self(false, null, $integrity, [], [], $failures);
    }
}
