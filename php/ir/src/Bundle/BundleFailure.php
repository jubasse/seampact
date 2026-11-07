<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * Why a bundle is refused. `file` is the bundle path, archive entry or manifest the failure is about; `expected`
 * and `actual` are the two values that differ (the manifest's or the pin, and what was found). Untrusted names are
 * quoted in `message` and kept exact in `file`.
 */
final readonly class BundleFailure
{
    public function __construct(
        public BundleFailureCode $code,
        public string $message,
        public string $fix,
        public ?string $file = null,
        public ?string $expected = null,
        public ?string $actual = null,
    ) {
    }
}
