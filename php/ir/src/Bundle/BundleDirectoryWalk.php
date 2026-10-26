<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/**
 * Every regular file under a bundle directory with its size, by POSIX path, without following links: a link or a
 * special file, or a bundle over the caps, is the failure.
 */
final class BundleDirectoryWalk
{
    private function __construct()
    {
    }

    /** @return array<string, int>|BundleFailure */
    public static function sizes(string $directory): array|BundleFailure
    {
        $sizes = [];
        $total = 0;
        $pending = [''];

        while ($pending !== []) {
            $relative = array_pop($pending);
            $names = scandir($relative === '' ? $directory : "{$directory}/{$relative}");

            if ($names === false) {
                throw new \RuntimeException("bundle: listing '{$directory}/{$relative}' failed; check the directory's permissions.");
            }

            foreach ($names as $name) {
                if ($name === '.' || $name === '..') {
                    continue;
                }

                $path = $relative === '' ? $name : "{$relative}/{$name}";
                $absolute = "{$directory}/{$path}";

                if (!is_link($absolute) && is_dir($absolute)) {
                    $pending[] = $path;
                    continue;
                }

                if (is_link($absolute) || !is_file($absolute)) {
                    return new BundleFailure(
                        BundleFailureCode::FileType,
                        BundleText::quoted($path) . ' is a link or a special file; a bundle holds regular files only.',
                        BundleLayout::REFETCH_FIX,
                        $path,
                    );
                }

                $size = filesize($absolute);
                if ($size === false) {
                    throw new \RuntimeException("bundle: reading the size of '{$absolute}' failed; check the directory's permissions.");
                }

                $sizes[$path] = $size;
                $total += $size;

                if (count($sizes) > BundleLayout::ENTRIES_MAX || $total > BundleLayout::EXTRACTED_BYTES_MAX) {
                    return self::overCap(count($sizes), $total);
                }
            }
        }

        return $sizes;
    }

    private static function overCap(int $fileCount, int $total): BundleFailure
    {
        if ($fileCount > BundleLayout::ENTRIES_MAX) {
            return new BundleFailure(
                BundleFailureCode::TooManyFiles,
                'The bundle holds more than ' . BundleLayout::ENTRIES_MAX . ' files.',
                BundleLayout::NOT_A_BUNDLE_FIX,
                expected: (string) BundleLayout::ENTRIES_MAX,
            );
        }

        return new BundleFailure(
            BundleFailureCode::TooLarge,
            "The bundle's files hold more than " . BundleLayout::EXTRACTED_BYTES_MAX . " bytes ({$total} so far).",
            BundleLayout::NOT_A_BUNDLE_FIX,
            expected: (string) BundleLayout::EXTRACTED_BYTES_MAX,
        );
    }
}
