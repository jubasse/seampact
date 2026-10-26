<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * Absolute paths for the binary channel: a path is made absolute once, before any check, and then used as is, so
 * the file checked and the file started are one file whatever directory the child starts in.
 */
final class AbsolutePath
{
    private const WINDOWS_FAMILY = 'Windows';

    private function __construct()
    {
    }

    /** Whether `$path` is absolute on this host: `isAbsoluteOnWindows` on Windows, else `isAbsoluteOnPosix`. */
    public static function isAbsolute(string $path): bool
    {
        return PHP_OS_FAMILY === self::WINDOWS_FAMILY ? self::isAbsoluteOnWindows($path) : self::isAbsoluteOnPosix($path);
    }

    /** A path from the filesystem root; `\x` and `C:/x` are relative names on POSIX. */
    public static function isAbsoluteOnPosix(string $path): bool
    {
        return str_starts_with($path, '/');
    }

    /** A drive path, a UNC path or a path from the root of the current drive. */
    public static function isAbsoluteOnWindows(string $path): bool
    {
        return str_starts_with($path, '/') || str_starts_with($path, '\\') || preg_match('/^[A-Za-z]:[\\\\\/]/', $path) === 1;
    }

    /** `$path` itself when absolute, else `$path` below the working directory of this process. */
    public static function resolved(string $path): string
    {
        if (self::isAbsolute($path)) {
            return $path;
        }

        $workingDirectory = getcwd();
        if ($workingDirectory === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CompileFailed,
                "The relative path '{$path}' cannot be made absolute: the working directory of PHP cannot be read.",
                'Run seampact from a directory your user can read, or pass absolute paths.',
            );
        }

        return $workingDirectory . DIRECTORY_SEPARATOR . $path;
    }
}
