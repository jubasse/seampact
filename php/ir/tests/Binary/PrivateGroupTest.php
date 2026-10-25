<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\PosixPathFacts;

/**
 * The private-group exception of the cache rule: a group other accounts have as their primary group is shared,
 * even when its member list is empty.
 */
#[RequiresOperatingSystemFamily('Linux')]
final class PrivateGroupTest extends TestCase
{
    private const PASSWD = '/etc/passwd';

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
