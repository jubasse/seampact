<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The POSIX cache rule, on the real path of the cache root: the copy, its directory and each directory up to the
 * cache root are owned by the current user, are not links and are not writable by group or others. Each directory
 * above the cache root, up to the filesystem root, is owned by the current user or by root, is not a link and is
 * not writable by others; it may be writable by its group only when that group is the running process's primary
 * group, since whoever can write there can already change the build tool's own files. No account database is read.
 */
final readonly class PosixCacheSafety implements CacheSafety
{
    private const OWNER_ONLY = 0700;

    private const GROUP_WRITE = 0020;

    private const OTHER_WRITE = 0002;

    private const ROOT_UID = 0;

    public function __construct(private PathFacts $facts = new PosixPathFacts())
    {
    }

    public function createPrivateDirectory(string $directory): void
    {
        $missing = [];
        for ($path = $directory; $this->facts->of($path) === null; $path = dirname($path)) {
            if (dirname($path) === $path) {
                break;
            }
            $missing[] = $path;
        }

        foreach (array_reverse($missing) as $path) {
            if (!@mkdir($path, self::OWNER_ONLY)) {
                // Another run may have created it first; the checks before each start read its modes.
                if ($this->facts->of($path) === null) {
                    throw self::unsafe($path, 'cannot be created', 'Check that your user can write its parent directory.');
                }

                continue;
            }

            // mkdir applies the umask; chmod does not.
            if (!chmod($path, self::OWNER_ONLY)) {
                throw self::unsafe($path, 'cannot be made private', "Run `chmod 700 '{$path}'`.");
            }
        }
    }

    public function refuseUnsafe(string $copyPath, string $cacheRoot): void
    {
        $uid = $this->facts->currentUid();

        for ($path = $copyPath; ; $path = dirname($path)) {
            $this->refuseUnsafeEntry($path, $uid);

            if ($path === $cacheRoot || dirname($path) === $path) {
                break;
            }
        }

        $gid = $this->facts->currentGid();

        for ($path = dirname($cacheRoot); ; $path = dirname($path)) {
            $this->refuseUnsafeAncestor($path, $uid, $gid);

            if (dirname($path) === $path) {
                break;
            }
        }
    }

    private function refuseUnsafeEntry(string $path, int $uid): void
    {
        $fact = $this->facts->of($path);

        if ($fact === null) {
            throw self::unsafe($path, 'is missing', 'Run seampact again; it installs the binary into its cache.');
        }

        if ($fact->isLink) {
            throw self::unsafe($path, 'is a link', "Remove the link '{$path}'; seampact recreates its cache.");
        }

        if ($fact->ownerUid !== $uid) {
            throw self::unsafe($path, "is owned by the user id {$fact->ownerUid}, not yours ({$uid})", 'Use a cache directory private to your user (COMPOSER_CACHE_DIR).');
        }

        if (($fact->mode & (self::GROUP_WRITE | self::OTHER_WRITE)) !== 0) {
            throw self::unsafe($path, sprintf('is writable by group or others (mode %o)', $fact->mode), "Run `chmod 700 '{$path}'`.");
        }
    }

    private function refuseUnsafeAncestor(string $path, int $uid, int $gid): void
    {
        $fact = $this->facts->of($path);

        if ($fact === null) {
            throw self::unsafe($path, 'is missing', 'Check that the cache directory exists.');
        }

        // The cache root is a real path: a link above it now was put there after it was resolved.
        if ($fact->isLink) {
            throw self::unsafe($path, 'is a link', 'Use a cache directory whose parents are not links (COMPOSER_CACHE_DIR).');
        }

        if ($fact->ownerUid !== $uid && $fact->ownerUid !== self::ROOT_UID) {
            throw self::unsafe($path, "is owned by the user id {$fact->ownerUid}, neither yours nor root", 'Use a cache directory whose parents only you or root can write (COMPOSER_CACHE_DIR).');
        }

        if (($fact->mode & self::OTHER_WRITE) !== 0) {
            throw self::unsafe($path, sprintf('is writable by others (mode %o)', $fact->mode), 'Use a cache directory private to your user (COMPOSER_CACHE_DIR).');
        }

        if (($fact->mode & self::GROUP_WRITE) !== 0 && $fact->groupId !== $gid) {
            throw self::unsafe(
                $path,
                sprintf('is writable by its group %d (mode %o), which is not the primary group of this process (%d)', $fact->groupId, $fact->mode, $gid),
                "Run `chmod g-w '{$path}'`, or use a cache directory private to your user (COMPOSER_CACHE_DIR).",
            );
        }
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
