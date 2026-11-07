<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * The bundle cache, by integrity value (ADR 0011 "Channels"), under `<cache root>/bundles/`. An entry is written
 * through a private temporary directory and a rename, so a reader never sees half of one, and the pinned-bundle
 * check runs again on every read: the cache is a copy, never a trust input. As `cache.ts`.
 */
final readonly class BundleCache
{
    private const BUNDLES_DIRECTORY = 'bundles';

    private const TEMPORARY_PREFIX = '.incoming-';

    private const INTEGRITY_PREFIX = 'sha256-';

    // A SHA-256 digest as `sha256-` and its padded standard base64.
    private const SHA256_INTEGRITY = '/^sha256-[A-Za-z0-9+\/]{43}=$/D';

    private const OWNER_ONLY = 0700;

    public function __construct(private string $directory)
    {
    }

    /** The entry directory of `$integrity`, or null when the value is not a SHA-256 one. */
    public function entryOf(string $integrity): ?string
    {
        if (preg_match(self::SHA256_INTEGRITY, $integrity) !== 1) {
            return null;
        }

        $digest = base64_decode(substr($integrity, strlen(self::INTEGRITY_PREFIX)), true);

        return $digest === false ? null : $this->bundlesDirectory() . '/sha256-' . bin2hex($digest);
    }

    /** Copies the checked bundle at `$bundle` to `$entry`; an entry another run wrote first is kept. */
    public function store(string $bundle, string $entry): void
    {
        if (file_exists($entry)) {
            return;
        }

        $parent = $this->bundlesDirectory();
        if (!is_dir($parent) && !@mkdir($parent, self::OWNER_ONLY, true) && !is_dir($parent)) {
            throw new \RuntimeException("bundle: creating the cache directory '{$parent}' failed; check that the cache directory is writable.");
        }

        $incoming = PrivateDirectory::create($parent, self::TEMPORARY_PREFIX);

        try {
            self::copyTree($bundle, $incoming);
        } catch (\RuntimeException $error) {
            PrivateDirectory::remove($incoming);
            throw $error;
        }

        if (!@rename($incoming, $entry)) {
            PrivateDirectory::remove($incoming);
            if (!file_exists($entry)) {
                throw new \RuntimeException("bundle: storing the cache entry '{$entry}' failed; check that the cache directory is writable.");
            }
        }
    }

    private function bundlesDirectory(): string
    {
        return $this->directory . '/' . self::BUNDLES_DIRECTORY;
    }

    private static function copyTree(string $source, string $target): void
    {
        foreach (scandir($source) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }

            $from = "{$source}/{$name}";
            $to = "{$target}/{$name}";
            if (is_dir($from) && !is_link($from)) {
                if (!mkdir($to, self::OWNER_ONLY)) {
                    throw new \RuntimeException("bundle: creating the cache directory '{$to}' failed.");
                }
                self::copyTree($from, $to);
            } elseif (is_link($from) || !copy($from, $to)) {
                throw new \RuntimeException("bundle: copying '{$from}' into the cache failed.");
            }
        }
    }
}
