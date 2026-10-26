<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The facts of the running system: `lstat`, and the effective user id and primary group id of `ext-posix`. */
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
        self::refuseWithoutPosix();

        return posix_geteuid();
    }

    public function currentGid(): int
    {
        self::refuseWithoutPosix();

        return posix_getgid();
    }

    private static function refuseWithoutPosix(): void
    {
        if (!function_exists('posix_geteuid') || !function_exists('posix_getgid')) {
            throw BinaryRefusedException::of(
                BinaryFailureCode::CacheUnsafe,
                'The owner of the binary cache cannot be checked: PHP has no ext-posix.',
                'Enable the posix extension of PHP; seampact checks that only your user can write the binary it runs.',
            );
        }
    }
}
