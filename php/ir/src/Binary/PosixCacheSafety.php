<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The POSIX cache rule: the copy, its directory and each directory up to the cache root are owned by the current
 * user, are not links and are not writable by group or others; each directory above the cache root, up to the
 * filesystem root, is owned by the current user or by root and is not writable by group or others, so a shared
 * cache directory is refused and the fix is a private one.
 */
final readonly class PosixCacheSafety implements CacheSafety
{
    private const OWNER_ONLY = 0700;

    private const GROUP_OR_OTHER_WRITE = 0022;

    private const ROOT_UID = 0;

    public function __construct(private string $cacheRoot, private PathFacts $facts = new PosixPathFacts())
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
            if (!@mkdir($path, self::OWNER_ONLY) && $this->facts->of($path) === null) {
                throw self::unsafe($path, "cannot be created", 'Check that your user can write its parent directory.');
            }

            // mkdir applies the umask; chmod does not. A directory another run created first is left as it is.
            if (!chmod($path, self::OWNER_ONLY)) {
                throw self::unsafe($path, 'cannot be made private', "Run `chmod 700 '{$path}'`.");
            }
        }
    }

    public function refuseUnsafe(string $copyPath): void
    {
        $uid = $this->facts->currentUid();

        for ($path = $copyPath; ; $path = dirname($path)) {
            $this->refuseUnsafeEntry($path, $uid);

            if ($path === $this->cacheRoot || dirname($path) === $path) {
                break;
            }
        }

        $parent = dirname($this->cacheRoot);
        for ($path = $this->facts->realDirectory($parent); ; $path = dirname($path)) {
            $this->refuseUnsafeAncestor($path, $uid);

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

        if (($fact->mode & self::GROUP_OR_OTHER_WRITE) !== 0) {
            throw self::unsafe($path, sprintf('is writable by group or others (mode %o)', $fact->mode), "Run `chmod 700 '{$path}'`.");
        }
    }

    private function refuseUnsafeAncestor(string $path, int $uid): void
    {
        $fact = $this->facts->of($path);

        if ($fact === null) {
            throw self::unsafe($path, 'is missing', 'Check that the cache directory exists.');
        }

        if ($fact->ownerUid !== $uid && $fact->ownerUid !== self::ROOT_UID) {
            throw self::unsafe($path, "is owned by the user id {$fact->ownerUid}, neither yours nor root", 'Use a cache directory whose parents only you or root can write (COMPOSER_CACHE_DIR).');
        }

        if (($fact->mode & self::GROUP_OR_OTHER_WRITE) !== 0) {
            throw self::unsafe($path, sprintf('is writable by group or others (mode %o), so the cache is shared', $fact->mode), 'Use a cache directory private to your user (COMPOSER_CACHE_DIR).');
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
