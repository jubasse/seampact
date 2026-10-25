<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/** The facts of the running system: `lstat`, the effective user id of `ext-posix`, and the account files. */
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
        $passwd = @file_get_contents(SystemAccounts::PASSWD_FILE);
        $group = @file_get_contents(SystemAccounts::GROUP_FILE);
        $nsswitch = is_file(SystemAccounts::NSSWITCH_FILE) ? @file_get_contents(SystemAccounts::NSSWITCH_FILE) : null;

        // An account file that cannot be read proves nothing: the group write is refused.
        if ($passwd === false || $group === false || $nsswitch === false) {
            return false;
        }

        return SystemAccounts::isPrivateGroup($groupId, $ownerUid, $passwd, $group, $nsswitch);
    }
}
