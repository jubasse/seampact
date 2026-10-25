<?php

declare(strict_types=1);

namespace Seampact\Hooks\Tests\Shape;

/** One arm of a shape manifest union: a nested type of its own (`name`), or another listed type (`type`). */
final readonly class ManifestArm
{
    /** @param list<ManifestMember> $members */
    public function __construct(
        public ?string $name,
        public ?string $type,
        public array $members,
    ) {
    }
}
