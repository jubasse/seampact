<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The bundle layout and the caps every reader applies (`@seampact/spec/bundle`): a bundle comes from the network,
 * so a bundle one reader refuses for size, every reader refuses.
 */
final class BundleLayout
{
    public const MANIFEST_FILE = 'seampact-bundle.json';
    public const SOURCES_DIRECTORY = 'sources';
    public const IR_DIRECTORY = 'ir';

    private const MEBIBYTE = 1024 * 1024;

    /** A tarball's compressed bytes. */
    public const ARCHIVE_BYTES_MAX = 64 * self::MEBIBYTE;

    /** A tarball's uncompressed bytes, and the sum of a bundle directory's file sizes. */
    public const EXTRACTED_BYTES_MAX = 256 * self::MEBIBYTE;

    /** The entries of a tarball, and the files of a bundle directory. */
    public const ENTRIES_MAX = 10_000;

    /** The manifest's bytes. */
    public const MANIFEST_BYTES_MAX = self::MEBIBYTE;

    public const REFETCH_FIX = 'Fetch the bundle again from its source; if it fails again, the source holds a tampered bundle.';
    public const NOT_A_BUNDLE_FIX = 'Check that the source names a seampact bundle; a bundle this large is not one.';
    public const REBUILD_FIX = 'Download the bundle again, or rebuild it with `seampact bundle`.';

    private function __construct()
    {
    }
}
