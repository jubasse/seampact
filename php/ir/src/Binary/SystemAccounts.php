<?php

declare(strict_types=1);

namespace Seampact\Ir\Binary;

/**
 * The private-group test on the system account files. A group is private to its owner when its name is the
 * owner's login, no other account has it as primary group and it lists no other member. Only `/etc/passwd` and
 * `/etc/group` prove it: when `/etc/nsswitch.conf` names another source for accounts or groups (LDAP, SSSD, NIS),
 * or the owner or the group is not listed in the files, the group is not proven private.
 */
final class SystemAccounts
{
    public const PASSWD_FILE = '/etc/passwd';

    public const GROUP_FILE = '/etc/group';

    public const NSSWITCH_FILE = '/etc/nsswitch.conf';

    // `systemd` serves its dynamic and home-directory users, whose ids never match a file account's.
    private const FILE_SOURCES = ['files', 'systemd'];

    private const DATABASES = ['passwd', 'group'];

    private function __construct()
    {
    }

    /** @param ?string $nsswitch the text of `/etc/nsswitch.conf`, or null when the system has none (files only) */
    public static function isPrivateGroup(int $groupId, int $ownerUid, string $passwd, string $group, ?string $nsswitch): bool
    {
        if ($nsswitch !== null && !self::readsFilesOnly($nsswitch)) {
            return false;
        }

        $accounts = self::records($passwd);
        $owners = array_values(array_filter($accounts, static fn (array $account): bool => ($account[2] ?? '') === (string) $ownerUid));
        $groups = array_values(array_filter(self::records($group), static fn (array $entry): bool => ($entry[2] ?? '') === (string) $groupId));

        if (count($owners) !== 1 || count($groups) !== 1) {
            return false;
        }

        $ownerName = $owners[0][0];
        if ($groups[0][0] !== $ownerName || ($owners[0][3] ?? '') !== (string) $groupId) {
            return false;
        }

        foreach ($accounts as $account) {
            if ($account[0] !== $ownerName && ($account[3] ?? '') === (string) $groupId) {
                return false;
            }
        }

        $members = array_filter(explode(',', $groups[0][3] ?? ''), static fn (string $member): bool => $member !== '');

        return array_diff($members, [$ownerName]) === [];
    }

    /**
     * The colon-separated records of an account file. A NIS `+` or `-` line brings accounts from elsewhere, so it
     * makes the file prove nothing: no record is returned.
     *
     * @return list<list<string>>
     */
    private static function records(string $text): array
    {
        $records = [];

        foreach (preg_split('/\R/', $text) ?: [] as $line) {
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            if (str_starts_with($line, '+') || str_starts_with($line, '-')) {
                return [];
            }

            $records[] = explode(':', $line);
        }

        return $records;
    }

    private static function readsFilesOnly(string $nsswitch): bool
    {
        foreach (preg_split('/\R/', $nsswitch) ?: [] as $line) {
            $line = trim(preg_replace('/#.*$/', '', $line) ?? '');

            if (preg_match('/^(\w+)\s*:(.*)$/', $line, $parts) !== 1 || !in_array($parts[1], self::DATABASES, true)) {
                continue;
            }

            // Action items such as `[NOTFOUND=return]` are not sources.
            $sources = preg_split('/\s+/', trim(preg_replace('/\[[^\]]*\]/', ' ', $parts[2]) ?? ''), -1, PREG_SPLIT_NO_EMPTY) ?: [];
            if (array_diff($sources, self::FILE_SOURCES) !== []) {
                return false;
            }
        }

        return true;
    }
}
