<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

use Seampact\Ir\Bundle\BundleSource;

/**
 * An app config as the PHP runner reads it. `entries` are the entries of this runner's ecosystem (Composer
 * packages); `otherEntries` those another runner generates, kept so a run can name them, never generated here. The
 * `openapi`, `checks` and `warnings` members are copies, as the config writes them, null when it does not.
 */
final readonly class AppConfig
{
    /**
     * @param array<string, LocalSource|BundleSource> $sources
     * @param list<AppConfigEntry> $entries
     * @param list<AppConfigEntry> $otherEntries
     */
    public function __construct(
        public string $displayName,
        public string $file,
        public string $directory,
        public string $outDir,
        public ?bool $allowLocal,
        public array $sources,
        public array $entries,
        public array $otherEntries,
        public mixed $openapi,
        public ?\stdClass $checks,
        public ?\stdClass $warnings,
    ) {
    }
}
