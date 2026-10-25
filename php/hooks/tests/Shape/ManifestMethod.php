<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/** One method of a shape manifest hook or class. */
final readonly class ManifestMethod
{
    /** @param list<string> $parameters */
    public function __construct(
        public string $name,
        public array $parameters,
        public bool $isStatic,
        public ?string $returns,
    ) {
    }
}
