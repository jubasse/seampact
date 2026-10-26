<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

/**
 * What one `vendor/bin/seampact` run reads besides the app config: the project directory (the root package's), the
 * app config file, the Composer vendor directory, the environment of this process, and the bundle download's
 * certificate authorities (null: the system's).
 */
final readonly class RunSettings
{
    /** @param array<string, string> $environment */
    public function __construct(
        public string $projectDirectory,
        public string $configFile,
        public string $vendorDirectory,
        public array $environment,
        public ?string $caFile = null,
    ) {
    }
}
