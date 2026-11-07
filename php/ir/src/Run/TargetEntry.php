<?php

declare(strict_types=1);

namespace Seampact\Ir\Run;

/**
 * One api of a target entry, as a generator receives it: the entry's `id` and `use`, the api, the entry's `options`
 * and `artefacts` (copies), the absolute `outputDirectory` the files go to (`<outDir>/<out>`, plus `/<api>` for an
 * entry with `apis`), `namespace`, the PSR-4 namespace of that directory in the app's `composer.json`, and the
 * entry's `frameworkRoutes` and `mount`, which the target's boot check reads.
 */
final readonly class TargetEntry
{
    public function __construct(
        public string $id,
        public string $use,
        public string $api,
        public ?string $document,
        public \stdClass $options,
        public \stdClass $artefacts,
        public string $outputDirectory,
        public string $namespace,
        /** @var list<FrameworkRoute> */
        public array $frameworkRoutes,
        public ?string $mount,
    ) {
    }
}
