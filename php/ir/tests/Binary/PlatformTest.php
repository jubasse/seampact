<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\HostLibc;
use Seampact\Ir\Binary\HostPlatform;

/** The `PHP_OS_FAMILY`, `php_uname('m')` and C library table of ADR 0010, pinned row by row. */
final class PlatformTest extends TestCase
{
    /** @return array<string, array{string, string, HostLibc, ?string}> */
    public static function rows(): array
    {
        return [
            'linux glibc x86_64' => ['Linux', 'x86_64', HostLibc::Glibc, 'seampact-linux-x64'],
            'linux glibc aarch64' => ['Linux', 'aarch64', HostLibc::Glibc, 'seampact-linux-arm64'],
            'darwin x86_64' => ['Darwin', 'x86_64', HostLibc::None, 'seampact-darwin-x64'],
            'darwin arm64' => ['Darwin', 'arm64', HostLibc::None, 'seampact-darwin-arm64'],
            'windows AMD64' => ['Windows', 'AMD64', HostLibc::None, 'seampact-win32-x64.exe'],
            'linux musl x86_64' => ['Linux', 'x86_64', HostLibc::Musl, null],
            'linux musl aarch64' => ['Linux', 'aarch64', HostLibc::Musl, null],
            'linux unknown libc' => ['Linux', 'x86_64', HostLibc::Unknown, null],
            'linux glibc arm64 spelling' => ['Linux', 'arm64', HostLibc::Glibc, null],
            'linux glibc armv7l' => ['Linux', 'armv7l', HostLibc::Glibc, null],
            'linux glibc i686' => ['Linux', 'i686', HostLibc::Glibc, null],
            'darwin aarch64 spelling' => ['Darwin', 'aarch64', HostLibc::None, null],
            'windows ARM64' => ['Windows', 'ARM64', HostLibc::None, null],
            'windows x86' => ['Windows', 'x86', HostLibc::None, null],
            'bsd amd64' => ['BSD', 'amd64', HostLibc::None, null],
            'solaris' => ['Solaris', 'i86pc', HostLibc::None, null],
            'unknown' => ['Unknown', 'x86_64', HostLibc::None, null],
        ];
    }

    #[DataProvider('rows')]
    public function testMapsTheHostToItsAssetOrRefusesItByName(string $osFamily, string $machine, HostLibc $libc, ?string $asset): void
    {
        $host = new HostPlatform($osFamily, $machine, $libc);

        if ($asset !== null) {
            self::assertSame($asset, $host->assetName());

            return;
        }

        try {
            $host->assetName();
            self::fail("{$osFamily} {$machine} {$libc->value} has no release asset.");
        } catch (BinaryRefusedException $refused) {
            self::assertSame(BinaryFailureCode::PlatformUnsupported, $refused->failure->code);
            self::assertStringContainsString("'{$osFamily}'", $refused->failure->message);
            self::assertStringContainsString("'{$machine}'", $refused->failure->message);
            self::assertStringContainsString($libc->value, $refused->failure->message);
            self::assertStringContainsString('bundle source', $refused->failure->fix);
            self::assertStringContainsString('glibc image', $refused->failure->fix);
            self::assertStringContainsString('path', $refused->failure->fix);
        }
    }

    /** @return array<string, array{?string, list<string>, HostLibc}> */
    public static function libcCases(): array
    {
        $glibcMaps = "7f00-7f01 r-xp 0 08:01 1 /usr/lib/x86_64-linux-gnu/libc.so.6\n";
        $muslMaps = "7f00-7f01 r-xp 0 08:01 1 /lib/ld-musl-x86_64.so.1\n";
        $staticMaps = "5600-5601 r-xp 0 08:01 1 /usr/local/bin/php\n";

        return [
            'glibc mapped' => [$glibcMaps, ['ld-musl-x86_64.so.1'], HostLibc::Glibc],
            'musl mapped' => [$muslMaps, ['ld-linux-x86-64.so.2'], HostLibc::Musl],
            'musl libc mapped' => ["7f00 r-xp 0 0 1 /usr/lib/libc.musl-x86_64.so.1\n", [], HostLibc::Musl],
            'no proc, musl loader' => [null, ['ld-musl-aarch64.so.1'], HostLibc::Musl],
            'no proc, glibc loader' => [null, ['ld-linux-aarch64.so.1'], HostLibc::Glibc],
            'static php, musl loader' => [$staticMaps, ['ld-musl-x86_64.so.1'], HostLibc::Musl],
            'static php, glibc loader' => [$staticMaps, ['ld-linux-x86-64.so.2'], HostLibc::Glibc],
            'neither' => [$staticMaps, ['libz.so.1'], HostLibc::Unknown],
            'nothing' => [null, [], HostLibc::Unknown],
        ];
    }

    /** @param list<string> $libraryEntries */
    #[DataProvider('libcCases')]
    public function testTellsTheLinuxCLibraryFromTheMapsThenTheLoaders(?string $maps, array $libraryEntries, HostLibc $expected): void
    {
        self::assertSame($expected, HostLibc::ofLinux($maps, $libraryEntries));
    }
}
