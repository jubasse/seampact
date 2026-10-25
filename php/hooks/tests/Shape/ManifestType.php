<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/** One type of the shape manifest. */
final readonly class ManifestType
{
    /**
     * @param list<string> $languages
     * @param list<ManifestMember> $members
     * @param list<ManifestArm> $arms
     * @param list<ManifestMethod> $methods
     * @param list<string> $values
     */
    public function __construct(
        public string $name,
        public string $kind,
        public array $languages,
        public array $members,
        public array $arms,
        public array $methods,
        public array $values,
    ) {
    }

    public function existsInPhp(): bool
    {
        return ShapeManifest::languagesIncludePhp($this->languages);
    }

    public function withMember(ManifestMember $member): self
    {
        return new self(
            $this->name,
            $this->kind,
            $this->languages,
            [...$this->members, $member],
            $this->arms,
            $this->methods,
            $this->values,
        );
    }
}
