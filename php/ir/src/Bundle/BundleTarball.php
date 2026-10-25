<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The bundle tarball reader (`schemas/bundle/README.md`, "Tarball"), with `ext-zlib` only. A tarball comes from
 * the network, so it is read whole in memory and every entry checked (`UstarParser`) before any byte is written.
 * The codes are those of the compiler's `tarball-read.ts`.
 */
final class BundleTarball
{
    // Small input chunks bound the output of one inflate call, so the extracted cap is checked as it grows.
    private const INFLATE_CHUNK_BYTES = 8 * 1024;

    private const TEMPORARY_PREFIX = 'seampact-bundle-';

    private const OWNER_ONLY = 0700;

    private function __construct()
    {
    }

    public static function read(string $tarball): BundleArchiveRead
    {
        $size = strlen($tarball);
        if ($size > BundleLayout::ARCHIVE_BYTES_MAX) {
            return BundleArchiveRead::refused(new BundleFailure(
                BundleFailureCode::ArchiveTooLarge,
                "The tarball holds {$size} bytes, over the cap of " . BundleLayout::ARCHIVE_BYTES_MAX . '.',
                BundleLayout::NOT_A_BUNDLE_FIX,
                expected: (string) BundleLayout::ARCHIVE_BYTES_MAX,
                actual: (string) $size,
            ));
        }

        $archive = self::gunzipped($tarball);

        return $archive instanceof BundleFailure ? BundleArchiveRead::refused($archive) : (new UstarParser($archive))->parse();
    }

    /**
     * Extracts a bundle tarball into a new owner-only directory under `$parentDirectory` (the system temporary
     * directory by default), which the caller removes; or refuses it whole and writes nothing.
     *
     * @return string|list<BundleFailure> the directory, or the failures
     */
    public static function extract(string $tarball, ?string $parentDirectory = null): string|array
    {
        $read = self::read($tarball);
        if ($read->failures !== []) {
            return $read->failures;
        }

        $directory = self::newPrivateDirectory($parentDirectory ?? sys_get_temp_dir());

        foreach ($read->entries as $entry) {
            $target = "{$directory}/{$entry->path}";
            $parent = dirname($target);

            if (!is_dir($parent) && !mkdir($parent, self::OWNER_ONLY, true) && !is_dir($parent)) {
                throw new \RuntimeException("bundle: creating '{$parent}' failed while writing the checked tarball into '{$directory}'.");
            }

            $handle = @fopen($target, 'x');
            if ($handle === false || fwrite($handle, $entry->bytes) !== strlen($entry->bytes) || !fclose($handle)) {
                throw new \RuntimeException("bundle: writing '{$target}' failed while writing the checked tarball into '{$directory}'.");
            }
        }

        return $directory;
    }

    private static function newPrivateDirectory(string $parent): string
    {
        $directory = $parent . '/' . self::TEMPORARY_PREFIX . bin2hex(random_bytes(8));

        if (!mkdir($directory, self::OWNER_ONLY) || !chmod($directory, self::OWNER_ONLY)) {
            throw new \RuntimeException("bundle: creating the directory '{$directory}' failed; check that '{$parent}' is writable.");
        }

        return $directory;
    }

    private static function gunzipped(string $tarball): string|BundleFailure
    {
        $problem = null;
        set_error_handler(static function (int $level, string $message) use (&$problem): bool {
            $problem = $message;

            return true;
        });

        try {
            return self::inflate($tarball, $problem);
        } finally {
            restore_error_handler();
        }
    }

    private static function inflate(string $tarball, ?string &$problem): string|BundleFailure
    {
        $context = inflate_init(ZLIB_ENCODING_GZIP);
        if ($context === false) {
            return BundleArchiveRead::archiveInvalid('zlib cannot start a gzip stream (' . BundleText::quoted($problem ?? 'no reason given') . ')');
        }

        $archive = '';
        $length = strlen($tarball);

        for ($offset = 0; $offset < $length || $offset === 0; $offset += self::INFLATE_CHUNK_BYTES) {
            $output = inflate_add($context, substr($tarball, $offset, self::INFLATE_CHUNK_BYTES), ZLIB_SYNC_FLUSH);

            if ($output === false) {
                return self::notGzip($problem);
            }

            $archive .= $output;
            if (strlen($archive) > BundleLayout::EXTRACTED_BYTES_MAX) {
                return new BundleFailure(
                    BundleFailureCode::ArchiveExtractedTooLarge,
                    'The tarball holds more than ' . BundleLayout::EXTRACTED_BYTES_MAX . ' bytes once uncompressed.',
                    BundleLayout::NOT_A_BUNDLE_FIX,
                    expected: (string) BundleLayout::EXTRACTED_BYTES_MAX,
                );
            }

            if (inflate_get_status($context) === ZLIB_STREAM_END) {
                return $archive;
            }

            if ($length === 0) {
                break;
            }
        }

        return BundleArchiveRead::archiveInvalid('the gzip data ends early');
    }

    private static function notGzip(?string $problem): BundleFailure
    {
        return BundleArchiveRead::archiveInvalid('it is not gzip data (' . BundleText::quoted($problem ?? 'zlib gave no reason') . ')');
    }
}
