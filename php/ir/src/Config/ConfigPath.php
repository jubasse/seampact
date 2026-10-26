<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

use Seampact\Ir\Binary\AbsolutePath;

/**
 * A config path (a `path` source, `outDir`, `out`), relative to the directory of the config that writes it, made
 * absolute and normalised by its text alone: `.` and `..` segments resolved, never through the filesystem.
 */
final class ConfigPath
{
    private function __construct()
    {
    }

    public static function resolve(string $directory, string $path): string
    {
        $joined = AbsolutePath::isAbsolute($path) ? $path : rtrim($directory, '/') . '/' . $path;

        return self::normalize($joined);
    }

    public static function normalize(string $path): string
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            $path = str_replace('\\', '/', $path);
        }

        $prefix = preg_match('#^([A-Za-z]:)?/#', $path, $match) === 1 ? $match[0] : '';
        $segments = [];

        foreach (explode('/', substr($path, strlen($prefix))) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }

            if ($segment === '..') {
                array_pop($segments);
                continue;
            }

            $segments[] = $segment;
        }

        return $prefix . implode('/', $segments);
    }

    /** Whether `$path` is `$directory` itself or a path below it. */
    public static function isAtOrBelow(string $path, string $directory): bool
    {
        return $path === $directory || str_starts_with($path, rtrim($directory, '/') . '/');
    }
}
