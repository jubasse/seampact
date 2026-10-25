<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The Windows cache rule, which replaces both POSIX owner rules: from the copy up to the user profile directory
 * (`%USERPROFILE%`), which Windows creates private, or up to the drive root for a cache outside the profile, no
 * path is a reparse point and the ACL of each grants write to no account but the current user, SYSTEM and
 * Administrators. The cache root needs no special case: the rule reads up to the profile or the drive root.
 */
final readonly class WindowsCacheSafety implements CacheSafety
{
    private const SYSTEM_SID = 'S-1-5-18';

    private const ADMINISTRATORS_SID = 'S-1-5-32-544';

    public function __construct(private string $userProfile, private WindowsPathFacts $facts = new PowerShellPathFacts())
    {
    }

    public function createPrivateDirectory(string $directory): void
    {
        if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw self::unsafe($directory, 'cannot be created', 'Check that your user can write %LOCALAPPDATA%.');
        }
    }

    public function refuseUnsafe(string $copyPath, string $cacheRoot): void
    {
        $paths = $this->pathsUpToProfile($copyPath);
        $fix = $this->isUnderProfile($copyPath)
            ? 'Keep %LOCALAPPDATA%\\seampact private to your user: remove the write rights of every other account.'
            : 'Keep the binary cache under %LOCALAPPDATA%, which only your user can write.';
        $facts = $this->facts->of($paths);
        $allowed = [$this->facts->currentUserSid(), self::SYSTEM_SID, self::ADMINISTRATORS_SID];

        foreach ($paths as $path) {
            $fact = $facts[$path] ?? throw self::unsafe($path, 'is missing', 'Run seampact again; it installs the binary into its cache.');

            if ($fact->isReparsePoint) {
                throw self::unsafe($path, 'is a reparse point (a link or a junction)', "Remove '{$path}'; seampact recreates its cache.");
            }

            $others = array_values(array_diff($fact->writerSids, $allowed));
            if ($others !== []) {
                throw self::unsafe($path, 'lets ' . implode(', ', $others) . ' write it', $fix);
            }
        }
    }

    /** @return list<string> the copy, then each parent up to the profile directory or the drive root included */
    private function pathsUpToProfile(string $copyPath): array
    {
        $profile = self::normalized($this->userProfile);
        $paths = [];

        for ($path = self::normalized($copyPath); ; $path = self::parentOf($path)) {
            $paths[] = $path;

            if (strcasecmp($path, $profile) === 0 || self::parentOf($path) === $path) {
                return $paths;
            }
        }
    }

    private function isUnderProfile(string $copyPath): bool
    {
        $profile = self::normalized($this->userProfile) . '\\';

        return strncasecmp(self::normalized($copyPath) . '\\', $profile, strlen($profile)) === 0;
    }

    private static function normalized(string $path): string
    {
        return rtrim(str_replace('/', '\\', $path), '\\');
    }

    // The parent of a path without a trailing backslash; a drive root (`C:\`) or a share root is its own parent.
    private static function parentOf(string $path): string
    {
        if (preg_match('/^[A-Za-z]:\\?$/D', $path) === 1 || preg_match('/^\\\\\\\\[^\\\\]+\\\\[^\\\\]+$/D', $path) === 1) {
            return $path;
        }

        $separator = strrpos($path, '\\');
        $parent = $separator === false ? '' : substr($path, 0, $separator);

        if ($parent === '') {
            return $path;
        }

        return preg_match('/^[A-Za-z]:$/D', $parent) === 1 ? $parent . '\\' : $parent;
    }

    private static function unsafe(string $path, string $problem, string $fix): BinaryRefusedException
    {
        return BinaryRefusedException::of(
            BinaryFailureCode::CacheUnsafe,
            "The binary cache path '{$path}' {$problem}; seampact runs only a binary no other user can change.",
            $fix,
        );
    }
}
