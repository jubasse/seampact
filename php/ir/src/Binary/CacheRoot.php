<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The binary cache root: `$COMPOSER_CACHE_DIR/seampact`, else `$XDG_CACHE_HOME/seampact`, else
 * `$HOME/.cache/seampact`; on Windows `%LOCALAPPDATA%\seampact`, whose ACL is per user.
 */
final class CacheRoot
{
    private const DIRECTORY = 'seampact';

    private function __construct()
    {
    }

    /**
     * @param array<string, string> $environment
     * @throws BinaryRefusedException `binary.cache-unavailable` when none of the variables is set
     */
    public static function locate(array $environment, bool $windows): string
    {
        $candidates = $windows
            ? [['LOCALAPPDATA', '']]
            : [['COMPOSER_CACHE_DIR', ''], ['XDG_CACHE_HOME', ''], ['HOME', '/.cache']];

        foreach ($candidates as [$variable, $below]) {
            $base = $environment[$variable] ?? '';
            if ($base !== '') {
                return rtrim($base, '/\\') . $below . DIRECTORY_SEPARATOR . self::DIRECTORY;
            }
        }

        $names = implode(', ', array_map(static fn (array $candidate): string => $candidate[0], $candidates));

        throw BinaryRefusedException::of(
            BinaryFailureCode::CacheUnavailable,
            "No cache directory for the compiler binary: none of {$names} is set.",
            $windows ? 'Run seampact as a Windows user with a profile (LOCALAPPDATA set).' : 'Set COMPOSER_CACHE_DIR or HOME to a directory private to your user.',
        );
    }
}
