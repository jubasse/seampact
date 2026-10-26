<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\CacheRoot;
use Seampact\Ir\Binary\PathFact;
use Seampact\Ir\Binary\PathFacts;
use Seampact\Ir\Binary\PosixCacheSafety;
use Seampact\Ir\Binary\WindowsCacheSafety;
use Seampact\Ir\Binary\WindowsPathFact;
use Seampact\Ir\Binary\WindowsPathFacts;

/**
 * The cache rules on injected file facts: the POSIX owner and mode rules up to the filesystem root, and the
 * Windows reparse-point and ACL rule up to the user profile. The Windows facts reader (PowerShell) cannot run on
 * Linux; only its decision logic is tested here.
 */
final class CacheRuleTest extends TestCase
{
    private const USER = 1000;
    private const OTHER_USER = 1001;
    private const ROOT = 0;
    private const PRIVATE_GROUP = 1000;
    private const SHARED_GROUP = 100;

    private const COPY = '/home/dev/.cache/composer/seampact/abc/seampact';
    private const CACHE_ROOT = '/home/dev/.cache/composer/seampact';

    private const USER_SID = 'S-1-5-21-1-2-3-1001';
    private const OTHER_SID = 'S-1-5-21-1-2-3-1002';
    private const EVERYONE_SID = 'S-1-1-0';
    private const PROFILE = 'C:\\Users\\dev';
    private const WINDOWS_COPY = 'C:\\Users\\dev\\AppData\\Local\\seampact\\abc\\seampact.exe';
    private const WINDOWS_CACHE_ROOT = 'C:\\Users\\dev\\AppData\\Local\\seampact';

    /** @return array<string, array{array<string, PathFact>, ?string}> the changed facts, and the path refused or null */
    public static function posixCases(): array
    {
        return [
            'a private cache under a home directory' => [[], null],
            'a copy owned by another user' => [[self::COPY => new PathFact(false, self::OTHER_USER, self::SHARED_GROUP, 0700)], self::COPY],
            'a link as the hash directory' => [[dirname(self::COPY) => new PathFact(true, self::USER, self::SHARED_GROUP, 0777)], dirname(self::COPY)],
            'a cache root its shared group may write' => [[self::CACHE_ROOT => new PathFact(false, self::USER, self::SHARED_GROUP, 0770)], self::CACHE_ROOT],
            'a cache root its owner private group may write (umask 002)' => [[self::CACHE_ROOT => new PathFact(false, self::USER, self::PRIVATE_GROUP, 0775)], null],
            'a hash directory others may write, private group or not' => [[dirname(self::COPY) => new PathFact(false, self::USER, self::PRIVATE_GROUP, 0777)], dirname(self::COPY)],
            'a hash directory its owner private group may write' => [[dirname(self::COPY) => new PathFact(false, self::USER, self::PRIVATE_GROUP, 0770)], dirname(self::COPY)],
            'a copy its owner private group may write' => [[self::COPY => new PathFact(false, self::USER, self::PRIVATE_GROUP, 0770)], self::COPY],
            'a link above the real cache root' => [['/home/dev/.cache' => new PathFact(true, self::USER, self::SHARED_GROUP, 0777)], '/home/dev/.cache'],
            'an ancestor its owner private group may write' => [['/home/dev' => new PathFact(false, self::USER, self::PRIVATE_GROUP, 0775)], null],
            'an ancestor its shared group may write' => [['/home/dev' => new PathFact(false, self::USER, self::SHARED_GROUP, 0775)], '/home/dev'],
            'a root-owned cache root' => [[self::CACHE_ROOT => new PathFact(false, self::ROOT, self::SHARED_GROUP, 0700)], self::CACHE_ROOT],
            'a shared directory above the root' => [['/home/dev/.cache' => new PathFact(false, self::USER, self::SHARED_GROUP, 01777)], '/home/dev/.cache'],
            'an ancestor owned by another user' => [['/home' => new PathFact(false, self::OTHER_USER, self::SHARED_GROUP, 0755)], '/home'],
        ];
    }

    /** @param array<string, PathFact> $changed */
    #[DataProvider('posixCases')]
    public function testAppliesThePosixRuleUpToTheFilesystemRoot(array $changed, ?string $refusedPath): void
    {
        $facts = [
            self::COPY => new PathFact(false, self::USER, self::SHARED_GROUP, 0700),
            dirname(self::COPY) => new PathFact(false, self::USER, self::SHARED_GROUP, 0700),
            self::CACHE_ROOT => new PathFact(false, self::USER, self::SHARED_GROUP, 0700),
            '/home/dev/.cache/composer' => new PathFact(false, self::USER, self::SHARED_GROUP, 0755),
            '/home/dev/.cache' => new PathFact(false, self::USER, self::SHARED_GROUP, 0700),
            '/home/dev' => new PathFact(false, self::USER, self::SHARED_GROUP, 0750),
            '/home' => new PathFact(false, self::ROOT, self::SHARED_GROUP, 0755),
            '/' => new PathFact(false, self::ROOT, self::SHARED_GROUP, 0755),
            ...$changed,
        ];
        $safety = new PosixCacheSafety(self::posixFacts($facts));

        $this->assertRefusal(static fn () => $safety->refuseUnsafe(self::COPY, self::CACHE_ROOT), $refusedPath);
    }

    /** @return array<string, array{array<string, WindowsPathFact>, ?string}> */
    public static function windowsCases(): array
    {
        return [
            'a private cache under the profile' => [[], null],
            'a copy others may write' => [[self::WINDOWS_COPY => new WindowsPathFact(false, [self::USER_SID, self::EVERYONE_SID])], self::WINDOWS_COPY],
            'a junction on the way' => [['C:\\Users\\dev\\AppData\\Local\\seampact' => new WindowsPathFact(true, [self::USER_SID])], 'C:\\Users\\dev\\AppData\\Local\\seampact'],
            'a profile another user may write' => [[self::PROFILE => new WindowsPathFact(false, [self::USER_SID, self::OTHER_SID])], self::PROFILE],
        ];
    }

    /** @param array<string, WindowsPathFact> $changed */
    #[DataProvider('windowsCases')]
    public function testAppliesTheWindowsRuleUpToTheUserProfile(array $changed, ?string $refusedPath): void
    {
        $private = new WindowsPathFact(false, [self::USER_SID, 'S-1-5-18', 'S-1-5-32-544']);
        $facts = [
            self::WINDOWS_COPY => $private,
            'C:\\Users\\dev\\AppData\\Local\\seampact\\abc' => $private,
            'C:\\Users\\dev\\AppData\\Local\\seampact' => $private,
            'C:\\Users\\dev\\AppData\\Local' => $private,
            'C:\\Users\\dev\\AppData' => $private,
            self::PROFILE => $private,
            ...$changed,
        ];
        $safety = new WindowsCacheSafety(self::PROFILE, self::windowsFacts($facts));

        $this->assertRefusal(static fn () => $safety->refuseUnsafe(self::WINDOWS_COPY, self::WINDOWS_CACHE_ROOT), $refusedPath);
    }

    public function testRefusesAWindowsCopyOutsideTheProfile(): void
    {
        $safety = new WindowsCacheSafety(self::PROFILE, self::windowsFacts([]));

        $this->assertRefusal(static fn () => $safety->refuseUnsafe('D:\\shared\\seampact.exe', 'D:\\shared'), 'D:\\shared\\seampact.exe');
    }

    /** @return array<string, array{array<string, string>, bool, ?string}> */
    public static function cacheRoots(): array
    {
        return [
            'composer cache' => [['COMPOSER_CACHE_DIR' => '/c', 'XDG_CACHE_HOME' => '/x', 'HOME' => '/h'], false, '/c/seampact'],
            'xdg cache' => [['XDG_CACHE_HOME' => '/x/', 'HOME' => '/h'], false, '/x/seampact'],
            'home' => [['HOME' => '/h'], false, '/h/.cache/seampact'],
            'windows' => [['LOCALAPPDATA' => 'C:\\Users\\dev\\AppData\\Local', 'HOME' => '/h'], true, 'C:\\Users\\dev\\AppData\\Local' . DIRECTORY_SEPARATOR . 'seampact'],
            'a relative xdg cache is ignored' => [['XDG_CACHE_HOME' => 'x', 'HOME' => '/h'], false, '/h/.cache/seampact'],
            'a relative composer cache is refused' => [['COMPOSER_CACHE_DIR' => 'c', 'HOME' => '/h'], false, null],
            'a relative home is refused' => [['HOME' => 'h'], false, null],
            'a backslash home is refused on POSIX' => [['HOME' => '\\h'], false, null],
            'a drive composer cache is refused on POSIX' => [['COMPOSER_CACHE_DIR' => 'C:/c', 'HOME' => '/h'], false, null],
            'a relative local app data is refused' => [['LOCALAPPDATA' => 'AppData\\Local'], true, null],
            'none' => [[], false, null],
            'none on windows' => [['HOME' => '/h'], true, null],
        ];
    }

    /** @param array<string, string> $environment */
    #[DataProvider('cacheRoots')]
    public function testLocatesTheCacheRootOrRefusesIt(array $environment, bool $windows, ?string $expected): void
    {
        if ($expected !== null) {
            self::assertSame(str_replace('/', DIRECTORY_SEPARATOR, $expected), str_replace('/', DIRECTORY_SEPARATOR, CacheRoot::locate($environment, $windows)));

            return;
        }

        try {
            CacheRoot::locate($environment, $windows);
            self::fail('No cache root was refused.');
        } catch (BinaryRefusedException $refused) {
            self::assertSame(BinaryFailureCode::CacheUnavailable, $refused->failure->code);
        }
    }

    private function assertRefusal(callable $check, ?string $refusedPath): void
    {
        try {
            $check();
        } catch (BinaryRefusedException $refused) {
            self::assertNotNull($refusedPath, $refused->getMessage());
            self::assertSame(BinaryFailureCode::CacheUnsafe, $refused->failure->code);
            self::assertStringContainsString("'{$refusedPath}'", $refused->failure->message);

            return;
        }

        self::assertNull($refusedPath, "'{$refusedPath}' was not refused.");
    }

    /** @param array<string, PathFact> $facts */
    private static function posixFacts(array $facts): PathFacts
    {
        return new class ($facts) implements PathFacts {
            /** @param array<string, PathFact> $facts */
            public function __construct(private readonly array $facts)
            {
            }

            public function of(string $path): ?PathFact
            {
                return $this->facts[$path] ?? null;
            }

            public function currentUid(): int
            {
                return 1000;
            }

            public function isPrivateGroup(int $groupId, int $ownerUid): bool
            {
                return $groupId === 1000 && $ownerUid === 1000;
            }
        };
    }

    /** @param array<string, WindowsPathFact> $facts */
    private static function windowsFacts(array $facts): WindowsPathFacts
    {
        return new class ($facts) implements WindowsPathFacts {
            /** @param array<string, WindowsPathFact> $facts */
            public function __construct(private readonly array $facts)
            {
            }

            public function of(array $paths): array
            {
                return array_intersect_key($this->facts, array_flip($paths));
            }

            public function currentUserSid(): string
            {
                return 'S-1-5-21-1-2-3-1001';
            }
        };
    }
}
