<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/** One member of a shape manifest type. */
final readonly class ManifestMember
{
    /** @param list<string> $languages */
    public function __construct(
        public string $name,
        public bool $optional,
        public bool $nullable,
        public ?string $enum,
        public array $languages,
    ) {
    }

    public function existsInPhp(): bool
    {
        return ShapeManifest::languagesIncludePhp($this->languages);
    }
}
