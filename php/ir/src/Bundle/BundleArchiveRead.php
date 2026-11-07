<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** The files of a bundle tarball in archive order, or the one failure that refuses it. */
final readonly class BundleArchiveRead
{
    /**
     * @param list<BundleEntry> $entries
     * @param list<BundleFailure> $failures
     */
    private function __construct(public array $entries, public array $failures)
    {
    }

    /** @param list<BundleEntry> $entries */
    public static function read(array $entries): self
    {
        return new self($entries, []);
    }

    public static function refused(BundleFailure $failure): self
    {
        return new self([], [$failure]);
    }

    public static function archiveInvalid(string $reason, ?string $file = null): BundleFailure
    {
        return new BundleFailure(BundleFailureCode::ArchiveInvalid, "The tarball cannot be read: {$reason}.", BundleLayout::REBUILD_FIX, $file);
    }
}
