<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\PosixPathFacts;
use Seampact\Ir\Binary\SystemAccounts;

/**
 * The private-group exception of the cache rule: only the system account files prove a group private, and a group
 * other accounts have as their primary group is shared, even when its member list is empty.
 */
final class PrivateGroupTest extends TestCase
{
    private const PASSWD = '/etc/passwd';

    private const OWNER_UID = 1000;

    private const GROUP_ID = 1000;

    private const ACCOUNTS = "root:x:0:0:root:/root:/bin/sh\ndev:x:1000:1000:Dev:/home/dev:/bin/sh\n";

    private const GROUPS = "root:x:0:\ndev:x:1000:\n";

    /** @return array<string, array{string, string, ?string, bool}> the passwd text, the group text, nsswitch.conf, and whether it is private */
    public static function accountFiles(): array
    {
        return [
            'a user private group' => [self::ACCOUNTS, self::GROUPS, null, true],
            'the owner listed as its own member' => [self::ACCOUNTS, "dev:x:1000:dev\n", null, true],
            'files and systemd sources' => [self::ACCOUNTS, self::GROUPS, "passwd: files systemd\ngroup: files [SUCCESS=merge] systemd\n", true],
            'a primary group another account shares' => [self::ACCOUNTS . "build:x:1001:1000::/home/build:/bin/sh\n", self::GROUPS, null, false],
            'another listed member' => [self::ACCOUNTS, "dev:x:1000:dev,build\n", null, false],
            'a group named apart from its owner' => [self::ACCOUNTS, "users:x:1000:\n", null, false],
            'a group that is not the owner primary group' => [str_replace(':1000:1000:', ':1000:100:', self::ACCOUNTS), self::GROUPS, null, false],
            'an owner missing from the files' => ["root:x:0:0:root:/root:/bin/sh\n", self::GROUPS, null, false],
            'a group missing from the files' => [self::ACCOUNTS, "root:x:0:\n", null, false],
            'accounts from a directory service' => [self::ACCOUNTS, self::GROUPS, "passwd: files sss\ngroup: files sss\n", false],
            'groups from LDAP' => [self::ACCOUNTS, self::GROUPS, "passwd: files\ngroup: files ldap\n", false],
            'a NIS include line' => [self::ACCOUNTS . "+::::::\n", self::GROUPS, null, false],
        ];
    }

    #[DataProvider('accountFiles')]
    public function testProvesAGroupPrivateFromTheSystemFilesOnly(string $passwd, string $group, ?string $nsswitch, bool $private): void
    {
        self::assertSame($private, SystemAccounts::isPrivateGroup(self::GROUP_ID, self::OWNER_UID, $passwd, $group, $nsswitch));
    }

    #[RequiresOperatingSystemFamily('Linux')]
    public function testRefusesAPrimaryGroupThatOtherAccountsShare(): void
    {
        [$groupId, $ownerUid] = self::sharedPrimaryGroup();

        self::assertFalse((new PosixPathFacts())->isPrivateGroup($groupId, $ownerUid));
    }

    /** @return array{int, int} a group id that two accounts of this system have as primary group, and one of them */
    private static function sharedPrimaryGroup(): array
    {
        $lines = file(self::PASSWD, FILE_IGNORE_NEW_LINES) ?: [];
        $uidsByGroup = [];

        foreach ($lines as $line) {
            $fields = explode(':', $line);
            if (count($fields) >= 4) {
                $uidsByGroup[(int) $fields[3]][] = (int) $fields[2];
            }
        }

        foreach ($uidsByGroup as $groupId => $uids) {
            if (count($uids) >= 2) {
                return [$groupId, $uids[0]];
            }
        }

        self::markTestSkipped('No two accounts of ' . self::PASSWD . ' share a primary group on this system.');
    }
}
