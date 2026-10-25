<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

use Seampact\Ir\Binary\PathFact;
use Seampact\Ir\Binary\PathFacts;
use Seampact\Ir\Binary\PosixPathFacts;

/**
 * The real facts below a test's own directory, and a root-owned private directory above it: the system temporary
 * directory is shared (mode 1777), which the cache rule rightly refuses, so a test cache lives under it this way.
 */
final readonly class TrustedAncestorFacts implements PathFacts
{
    private PosixPathFacts $real;

    public function __construct(private string $testDirectory)
    {
        $this->real = new PosixPathFacts();
    }

    public function of(string $path): ?PathFact
    {
        if (str_starts_with($path . '/', $this->testDirectory . '/')) {
            return $this->real->of($path);
        }

        return new PathFact(false, 0, 0, 0755);
    }

    public function currentUid(): int
    {
        return $this->real->currentUid();
    }

    public function isPrivateGroup(int $groupId, int $ownerUid): bool
    {
        return $this->real->isPrivateGroup($groupId, $ownerUid);
    }

    public function realDirectory(string $path): string
    {
        return $this->real->realDirectory($path);
    }
}
