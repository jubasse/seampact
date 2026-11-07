<?php

declare(strict_types=1);

namespace Seampact\Ir\Bundle;

/** A directory seampact creates owner-only for one run (an extracted bundle, a fetched tag), and removes whole. */
final class PrivateDirectory
{
    private const OWNER_ONLY = 0700;

    private function __construct()
    {
    }

    public static function create(string $parent, string $prefix): string
    {
        $directory = $parent . '/' . $prefix . bin2hex(random_bytes(8));

        if (!@mkdir($directory, self::OWNER_ONLY) || !chmod($directory, self::OWNER_ONLY)) {
            throw new \RuntimeException("bundle: creating the directory '{$directory}' failed; check that '{$parent}' is writable.");
        }

        return $directory;
    }

    // Only a directory seampact created; links inside it are removed, never followed.
    public static function remove(string $directory): void
    {
        foreach (scandir($directory) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }

            $path = "{$directory}/{$name}";
            if (is_dir($path) && !is_link($path)) {
                self::remove($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($directory);
    }
}
