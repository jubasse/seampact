<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The bundle tarball reader (`schemas/bundle/README.md`, "Tarball"), with `ext-zlib` only. A tarball comes from
 * the network, so it is inflated in bounded chunks into a private temporary file, the extracted cap checked before
 * each write, never whole in memory; bytes after the gzip stream are refused, as the compiler's reader refuses
 * them. Every entry is checked (`UstarParser`) before any byte is written. The codes are those of the compiler's
 * `tarball-read.ts`.
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
        $archive = self::uncompressed($tarball);
        if ($archive instanceof BundleFailure) {
            return BundleArchiveRead::refused($archive);
        }

        try {
            return (new UstarParser($archive['stream'], $archive['bytes']))->parse();
        } finally {
            fclose($archive['stream']);
        }
    }

    /**
     * Extracts a bundle tarball into a new owner-only directory under `$parentDirectory` (the system temporary
     * directory by default), which the caller removes; or refuses it whole and writes nothing. A write that fails
     * removes what it wrote before it throws.
     *
     * @return string|list<BundleFailure> the directory, or the failures
     */
    public static function extract(string $tarball, ?string $parentDirectory = null): string|array
    {
        $archive = self::uncompressed($tarball);
        if ($archive instanceof BundleFailure) {
            return [$archive];
        }

        try {
            $read = (new UstarParser($archive['stream'], $archive['bytes']))->parse();
            if ($read->failures !== []) {
                return $read->failures;
            }

            $directory = self::newPrivateDirectory($parentDirectory ?? sys_get_temp_dir());

            try {
                self::writeEntries($archive['stream'], $read->entries, $directory);
            } catch (\RuntimeException $failure) {
                self::removeDirectory($directory);
                throw $failure;
            }

            return $directory;
        } finally {
            fclose($archive['stream']);
        }
    }

    /**
     * @param resource $archive
     * @param list<BundleEntry> $entries
     */
    private static function writeEntries($archive, array $entries, string $directory): void
    {
        foreach ($entries as $entry) {
            $target = "{$directory}/{$entry->path}";
            $parent = dirname($target);

            if (!is_dir($parent) && !mkdir($parent, self::OWNER_ONLY, true) && !is_dir($parent)) {
                throw new \RuntimeException("bundle: creating '{$parent}' failed while writing the checked tarball; nothing of it was kept.");
            }

            $handle = @fopen($target, 'x');
            $copied = $handle === false ? false : stream_copy_to_stream($archive, $handle, $entry->size, $entry->offset);

            if ($handle === false || $copied !== $entry->size || !fclose($handle)) {
                throw new \RuntimeException("bundle: writing '{$target}' failed while writing the checked tarball; nothing of it was kept.");
            }
        }
    }

    // The directory this reader created; links inside it are removed, never followed.
    private static function removeDirectory(string $directory): void
    {
        foreach (scandir($directory) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }

            $path = "{$directory}/{$name}";
            if (is_dir($path) && !is_link($path)) {
                self::removeDirectory($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($directory);
    }

    private static function newPrivateDirectory(string $parent): string
    {
        $directory = $parent . '/' . self::TEMPORARY_PREFIX . bin2hex(random_bytes(8));

        if (!mkdir($directory, self::OWNER_ONLY) || !chmod($directory, self::OWNER_ONLY)) {
            throw new \RuntimeException("bundle: creating the directory '{$directory}' failed; check that '{$parent}' is writable.");
        }

        return $directory;
    }

    /** @return array{stream: resource, bytes: int}|BundleFailure the uncompressed archive in a private temporary file */
    private static function uncompressed(string $tarball): array|BundleFailure
    {
        $size = strlen($tarball);
        if ($size > BundleLayout::ARCHIVE_BYTES_MAX) {
            return new BundleFailure(
                BundleFailureCode::ArchiveTooLarge,
                "The tarball holds {$size} bytes, over the cap of " . BundleLayout::ARCHIVE_BYTES_MAX . '.',
                BundleLayout::NOT_A_BUNDLE_FIX,
                expected: (string) BundleLayout::ARCHIVE_BYTES_MAX,
                actual: (string) $size,
            );
        }

        // tmpfile() is created owner-only and deleted when closed.
        $stream = tmpfile();
        if ($stream === false) {
            throw new \RuntimeException('bundle: creating a temporary file for the uncompressed tarball failed; check that the system temporary directory is writable.');
        }

        $problem = null;
        set_error_handler(static function (int $level, string $message) use (&$problem): bool {
            $problem = $message;

            return true;
        });

        try {
            $bytes = self::inflateInto($tarball, $stream, $problem);
        } finally {
            restore_error_handler();
        }

        if ($bytes instanceof BundleFailure) {
            fclose($stream);

            return $bytes;
        }

        return ['stream' => $stream, 'bytes' => $bytes];
    }

    /**
     * @param resource $stream
     * @return int|BundleFailure the uncompressed size
     */
    private static function inflateInto(string $tarball, $stream, ?string &$problem): int|BundleFailure
    {
        $context = inflate_init(ZLIB_ENCODING_GZIP);
        if ($context === false) {
            return BundleArchiveRead::archiveInvalid('zlib cannot start a gzip stream (' . BundleText::quoted($problem ?? 'no reason given') . ')');
        }

        $written = 0;
        $length = strlen($tarball);

        for ($offset = 0; $offset < $length || $offset === 0; $offset += self::INFLATE_CHUNK_BYTES) {
            $output = inflate_add($context, substr($tarball, $offset, self::INFLATE_CHUNK_BYTES), ZLIB_SYNC_FLUSH);

            if ($output === false) {
                return self::notGzip($problem);
            }

            if ($written + strlen($output) > BundleLayout::EXTRACTED_BYTES_MAX) {
                return new BundleFailure(
                    BundleFailureCode::ArchiveExtractedTooLarge,
                    'The tarball holds more than ' . BundleLayout::EXTRACTED_BYTES_MAX . ' bytes once uncompressed.',
                    BundleLayout::NOT_A_BUNDLE_FIX,
                    expected: (string) BundleLayout::EXTRACTED_BYTES_MAX,
                );
            }

            if ($output !== '' && fwrite($stream, $output) !== strlen($output)) {
                throw new \RuntimeException('bundle: writing the uncompressed tarball into a temporary file failed; check the free space of the temporary directory.');
            }
            $written += strlen($output);

            if (inflate_get_status($context) === ZLIB_STREAM_END) {
                return inflate_get_read_len($context) === $length ? $written : self::trailingBytes($length - inflate_get_read_len($context));
            }

            if ($length === 0) {
                break;
            }
        }

        return BundleArchiveRead::archiveInvalid('the gzip data ends early');
    }

    private static function trailingBytes(int $count): BundleFailure
    {
        return BundleArchiveRead::archiveInvalid("{$count} bytes follow after the end of the gzip data");
    }

    private static function notGzip(?string $problem): BundleFailure
    {
        return BundleArchiveRead::archiveInvalid('it is not gzip data (' . BundleText::quoted($problem ?? 'zlib gave no reason') . ')');
    }
}
