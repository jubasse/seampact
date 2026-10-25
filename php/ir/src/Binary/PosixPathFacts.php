<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The facts of the running system: `lstat` and the effective user id of `ext-posix`. */
final class PosixPathFacts implements PathFacts
{
    public function of(string $path): ?PathFact
    {
        clearstatcache(true, $path);
        $stat = @lstat($path);

        if ($stat === false) {
            return null;
        }

        return new PathFact(is_link($path), $stat['uid'], $stat['gid'], $stat['mode'] & 07777);
    }

    public function currentUid(): int
    {
        if (!function_exists('posix_geteuid')) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                'The owner of the binary cache cannot be checked: PHP has no ext-posix.',
                'Enable the posix extension of PHP; seampact checks that only your user can write the binary it runs.',
            );
        }

        return posix_geteuid();
    }

    public function isPrivateGroup(int $groupId, int $ownerUid): bool
    {
        if (!function_exists('posix_getpwuid') || !function_exists('posix_getgrgid')) {
            return false;
        }

        $owner = posix_getpwuid($ownerUid);
        $group = posix_getgrgid($groupId);
        if ($owner === false || $group === false || $owner['gid'] !== $groupId) {
            return false;
        }

        return array_diff($group['members'], [$owner['name']]) === [];
    }

    public function realDirectory(string $path): string
    {
        $real = realpath($path);

        if ($real === false) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                "The directory '{$path}' above the binary cache cannot be resolved.",
                'Check that the cache directory exists and that your user can read its parents.',
            );
        }

        return $real;
    }
}
