<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The Windows cache rule, which replaces both POSIX owner rules: from the copy up to the user profile directory
 * (`%USERPROFILE%`), which Windows creates private, no path is a reparse point and the ACL of each grants write to
 * no account but the current user, SYSTEM and Administrators.
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

    public function refuseUnsafe(string $copyPath): void
    {
        $paths = $this->pathsUpToProfile($copyPath);
        $facts = $this->facts->of($paths);
        $allowed = [$this->facts->currentUserSid(), self::SYSTEM_SID, self::ADMINISTRATORS_SID];

        foreach ($paths as $path) {
            $fact = $facts[$path] ?? throw self::unsafe($path, 'is missing', 'Run seampact again; it installs the binary into its cache.');

            if ($fact->isReparsePoint) {
                throw self::unsafe($path, 'is a reparse point (a link or a junction)', "Remove '{$path}'; seampact recreates its cache.");
            }

            $others = array_values(array_diff($fact->writerSids, $allowed));
            if ($others !== []) {
                throw self::unsafe($path, 'lets ' . implode(', ', $others) . ' write it', 'Keep %LOCALAPPDATA%\\seampact private to your user: remove the write rights of every other account.');
            }
        }
    }

    /** @return list<string> the copy, then each parent up to the profile directory included */
    private function pathsUpToProfile(string $copyPath): array
    {
        $profile = rtrim(str_replace('/', '\\', $this->userProfile), '\\');
        $paths = [];

        for ($path = rtrim(str_replace('/', '\\', $copyPath), '\\'); ; $path = self::parentOf($path)) {
            $paths[] = $path;

            if (strcasecmp($path, $profile) === 0) {
                return $paths;
            }

            if (self::parentOf($path) === $path) {
                throw self::unsafe($copyPath, "is not under the user profile '{$profile}'", 'Keep the binary cache under %LOCALAPPDATA%.');
            }
        }
    }

    // The parent of a path without a trailing backslash; a drive or share root is its own parent.
    private static function parentOf(string $path): string
    {
        $separator = strrpos($path, '\\');
        $parent = $separator === false ? '' : substr($path, 0, $separator);

        return $parent === '' || preg_match('/^[A-Za-z]:$/D', $parent) === 1 ? $path : $parent;
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
