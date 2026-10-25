<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The private, content-addressed copy of the binary, the only file seampact runs, and the checks it passes. */
final readonly class InstalledBinary
{
    public function __construct(public string $path, public string $sha256, public CacheSafety $safety)
    {
    }

    /**
     * Runs the cache checks and hashes the copy again, right before a start.
     *
     * @throws BinaryRefusedException `binary.cache-unsafe` or `binary.hash-mismatch`
     */
    public function refuseUnlessIntact(): void
    {
        $this->safety->refuseUnsafe($this->path);
        $actual = hash_file('sha256', $this->path);

        if ($actual !== $this->sha256) {
            throw BinaryInstaller::hashMismatch($this->path, $this->sha256, $actual === false ? 'unreadable' : $actual);
        }
    }
}
