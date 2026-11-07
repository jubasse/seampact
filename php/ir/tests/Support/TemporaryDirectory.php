<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Support;

/** A directory a test creates under the system temporary directory and removes with everything it wrote there. */
final class TemporaryDirectory
{
    public static function create(string $prefix): string
    {
        $directory = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(6));

        if (!mkdir($directory, 0700) || !chmod($directory, 0700)) {
            throw new \RuntimeException("test: creating '{$directory}' failed.");
        }

        return $directory;
    }

    /** Removes `$directory`, which a test created, without following any link inside it. */
    public static function remove(string $directory): void
    {
        if (!is_dir($directory) || is_link($directory)) {
            return;
        }

        foreach (scandir($directory) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }

            $path = "{$directory}/{$name}";
            if (is_dir($path) && !is_link($path)) {
                chmod($path, 0700);
                self::remove($path);
            } else {
                unlink($path);
            }
        }

        rmdir($directory);
    }

    /** Writes `$bytes` at `$relativePath` below `$directory`, creating the parent directories. */
    public static function write(string $directory, string $relativePath, string $bytes): string
    {
        $path = "{$directory}/{$relativePath}";
        $parent = dirname($path);

        if (!is_dir($parent) && !mkdir($parent, 0700, true)) {
            throw new \RuntimeException("test: creating '{$parent}' failed.");
        }

        if (file_put_contents($path, $bytes) !== strlen($bytes)) {
            throw new \RuntimeException("test: writing '{$path}' failed.");
        }

        return $path;
    }
}
