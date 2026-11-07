<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The binary cache root: `$COMPOSER_CACHE_DIR/seampact`, else `$XDG_CACHE_HOME/seampact`, else
 * `$HOME/.cache/seampact`; on Windows `%LOCALAPPDATA%\seampact`, whose ACL is per user. A relative
 * `XDG_CACHE_HOME` is ignored, as the XDG specification says; any other relative variable is refused by name, so
 * the cache never depends on the directory a command starts in.
 */
final class CacheRoot
{
    private const DIRECTORY = 'seampact';

    // A relative value of this variable is ignored (XDG Base Directory specification); others are refused.
    private const IGNORED_WHEN_RELATIVE = 'XDG_CACHE_HOME';

    private function __construct()
    {
    }

    /**
     * @param array<string, string> $environment
     * @return string an absolute path
     * @throws BinaryRefusedException `binary.cache-unavailable` when none of the variables is set or the one
     *     read is relative
     */
    public static function locate(array $environment, bool $windows): string
    {
        $candidates = $windows
            ? [['LOCALAPPDATA', '']]
            : [['COMPOSER_CACHE_DIR', ''], [self::IGNORED_WHEN_RELATIVE, ''], ['HOME', '/.cache']];

        foreach ($candidates as [$variable, $below]) {
            $base = $environment[$variable] ?? '';
            $isAbsolute = $windows ? AbsolutePath::isAbsoluteOnWindows($base) : AbsolutePath::isAbsoluteOnPosix($base);
            if ($base === '' || (!$isAbsolute && $variable === self::IGNORED_WHEN_RELATIVE)) {
                continue;
            }

            if (!$isAbsolute) {
                throw self::relative($variable, $base);
            }

            return rtrim($base, '/\\') . $below . DIRECTORY_SEPARATOR . self::DIRECTORY;
        }

        $names = implode(', ', array_map(static fn (array $candidate): string => $candidate[0], $candidates));

        throw BinaryRefusedException::of(
            BinaryFailureCode::CacheUnavailable,
            "No cache directory for the compiler binary: none of {$names} is set.",
            $windows ? 'Run seampact as a Windows user with a profile (LOCALAPPDATA set).' : 'Set COMPOSER_CACHE_DIR or HOME to a directory private to your user.',
        );
    }

    private static function relative(string $variable, string $value): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::CacheUnavailable,
            "{$variable} is the relative path '{$value}', so the binary cache would depend on the directory seampact starts in.",
            "Set {$variable} to an absolute path, such as \"\$PWD/{$value}\" in your CI configuration.",
        );
    }
}
