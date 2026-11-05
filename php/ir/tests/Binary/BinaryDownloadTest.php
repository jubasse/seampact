<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Binary;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\RequiresOperatingSystemFamily;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Binary\BinaryDownload;
use Seampact\Ir\Binary\BinaryFailure;
use Seampact\Ir\Binary\BinaryFailureCode;
use Seampact\Ir\Binary\BinaryRefusedException;
use Seampact\Ir\Binary\CompilerBinary;
use Seampact\Ir\Binary\HostLibc;
use Seampact\Ir\Binary\HostPlatform;
use Seampact\Ir\Binary\InstalledBinary;
use Seampact\Ir\Binary\PosixCacheSafety;
use Seampact\Ir\Binary\ReleaseAssets;
use Seampact\Ir\Binary\RootPackage;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\TlsServer;
use Seampact\Ir\Tests\Support\TrustedAncestorFacts;

/**
 * A filled pin downloads this host's release asset over TLS, checks its hash before it is ever run, and caches it:
 * from the embedded pins, a `version` override or a mirror `url`.
 */
#[RequiresOperatingSystemFamily('Linux')]
final class BinaryDownloadTest extends TestCase
{
    // The stub touches the file its first argument names, so a test sees that it ran.
    private const STUB = "#!/bin/sh\ntouch \"\$1\"\n";

    private const VERSION = '1.2.3';

    private const OTHER_SHA256 = '0000000000000000000000000000000000000000000000000000000000000000';

    private const TRICKLE_DEADLINE_SECONDS = 1.0;

    // The server trickles the headers for three seconds.
    private const TRICKLE_STOP_WITHIN_SECONDS = 2.5;

    private static TlsServer $server;

    private string $project;

    public static function setUpBeforeClass(): void
    {
        self::$server = TlsServer::start('', [ReleaseAssets::LINUX_X64 => self::STUB]);
    }

    public static function tearDownAfterClass(): void
    {
        self::$server->stop();
    }

    protected function setUp(): void
    {
        $this->project = TemporaryDirectory::create('seampact-download-');
    }

    protected function tearDown(): void
    {
        TemporaryDirectory::remove($this->project);
    }

    /** @return array<string, array{?array<string, mixed>}> */
    public static function pinnedSources(): array
    {
        return [
            'the embedded pins' => [null],
            'a version override' => [['version' => self::VERSION, 'sha256' => self::hashes(hash('sha256', self::STUB))]],
            'a mirror url' => [['url' => 'MIRROR', 'sha256' => self::hashes(hash('sha256', self::STUB))]],
        ];
    }

    /** @param ?array<string, mixed> $binary */
    #[DataProvider('pinnedSources')]
    public function testDownloadsTheHostAssetAndRunsIt(?array $binary): void
    {
        $this->writeComposer($binary);
        $this->writePins(self::VERSION, hash('sha256', self::STUB));

        $installed = $this->install();

        self::assertStringStartsWith("{$this->project}/cache/seampact/", $installed->path);
        self::assertSame(hash('sha256', self::STUB), hash_file('sha256', $installed->path));
        $this->assertRuns($installed);
    }

    public function testRefusesAnAssetWhoseHashIsNotThePinAndInstallsNothing(): void
    {
        $this->writeComposer(null);
        $this->writePins(self::VERSION, self::OTHER_SHA256);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::HashMismatch, $refused->code);
        self::assertStringContainsString(hash('sha256', self::STUB), $refused->message);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/*") ?: []);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/.*.tmp") ?: []);
    }

    public function testRefusesAMissingAssetByItsUrlAndStatus(): void
    {
        $this->writeComposer(['url' => str_replace('://', '://user:secret@', self::$server->url('/missing')), 'sha256' => self::hashes(hash('sha256', self::STUB))]);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('answered HTTP 404', $refused->message);
        self::assertStringNotContainsString('secret', $refused->message);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/*") ?: []);
    }

    public function testRefusesAnHttpMirror(): void
    {
        $this->writeComposer(['url' => 'http://127.0.0.1/assets', 'sha256' => self::hashes(hash('sha256', self::STUB))]);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('not an absolute https: URL', $refused->message);
    }

    public function testRefusesABodyCutBeforeItsLength(): void
    {
        $this->writeComposer(['url' => self::$server->url('/truncated'), 'sha256' => self::hashes(hash('sha256', self::STUB))]);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('ended after 10 of 100 bytes', $refused->message);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/*") ?: []);
        self::assertSame([], glob("{$this->project}/cache/seampact/*/.*.tmp") ?: []);
    }

    public function testRefusesAUrlHoldingANulByteBeforeTheCacheIsTouched(): void
    {
        $this->writeComposer(['url' => self::$server->url("/assets\0x"), 'sha256' => self::hashes(hash('sha256', self::STUB))]);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('was not tried: it holds a control character or a space', $refused->message);
        self::assertDirectoryDoesNotExist("{$this->project}/cache/seampact");
    }

    public function testRefusesAMirrorBaseWithAQuery(): void
    {
        $this->writeComposer(['url' => self::$server->url('/assets?token=secret'), 'sha256' => self::hashes(hash('sha256', self::STUB))]);

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('has a query or a fragment', $refused->message);
        self::assertStringNotContainsString('secret', $refused->message);
        self::assertDirectoryDoesNotExist("{$this->project}/cache/seampact");
    }

    public function testStopsAtTheDeadlineWhileTheHeadersTrickleIn(): void
    {
        $this->writeComposer(['url' => self::$server->url('/trickle-headers'), 'sha256' => self::hashes(hash('sha256', self::STUB))]);
        $started = microtime(true);

        $refused = $this->refusal(self::TRICKLE_DEADLINE_SECONDS);

        self::assertSame(BinaryFailureCode::FetchFailed, $refused->code);
        self::assertStringContainsString('took over 1000 ms', $refused->message);
        self::assertLessThan(self::TRICKLE_STOP_WITHIN_SECONDS, microtime(true) - $started);
    }

    public function testRefusesADevelopmentPinByName(): void
    {
        $this->writeComposer(null);
        $this->writePins('0.0.0', hash('sha256', self::STUB));

        $refused = $this->refusal();

        self::assertSame(BinaryFailureCode::PinInvalid, $refused->code);
        self::assertStringContainsString('pins version 0.0.0, a development pin', $refused->message);
    }

    public function testReusesTheCachedBinaryWithoutDownloadingItAgain(): void
    {
        $this->writeComposer(null);
        $this->writePins(self::VERSION, hash('sha256', self::STUB));
        $first = $this->install();
        $served = self::$server->assetsDirectory() . '/' . ReleaseAssets::LINUX_X64;
        unlink($served);

        try {
            $second = $this->install();
        } finally {
            TemporaryDirectory::write(self::$server->assetsDirectory(), ReleaseAssets::LINUX_X64, self::STUB);
        }

        self::assertSame($first->path, $second->path);
        $this->assertRuns($second);
    }

    /** @return array<string, string> one hash per release asset, `$hostSha256` for this host's */
    private static function hashes(string $hostSha256): array
    {
        $hashes = array_fill_keys(ReleaseAssets::BINARIES, self::OTHER_SHA256);
        $hashes[ReleaseAssets::LINUX_X64] = $hostSha256;

        return $hashes;
    }

    /** @param ?array<string, mixed> $binary `url` `MIRROR` stands for the test server's assets */
    private function writeComposer(?array $binary): void
    {
        $composer = ['name' => 'acme/app'];
        if ($binary !== null) {
            if (($binary['url'] ?? null) === 'MIRROR') {
                $binary['url'] = self::$server->url('/assets/');
            }
            $composer['extra'] = ['seampact' => ['binary' => $binary]];
        }

        TemporaryDirectory::write($this->project, 'composer.json', (string) json_encode($composer));
    }

    private function writePins(string $version, string $hostSha256): void
    {
        TemporaryDirectory::write($this->project, 'binaries.json', (string) json_encode(['version' => $version, 'sha256' => self::hashes($hostSha256)]));
    }

    private function install(float $deadlineSeconds = 10.0): InstalledBinary
    {
        // The release URL `<base>/v<version>/<asset>` is served from the assets directory by its last segment.
        return CompilerBinary::install(
            RootPackage::locate($this->project, []),
            "{$this->project}/vendor",
            new HostPlatform('Linux', 'x86_64', HostLibc::Glibc),
            ['COMPOSER_CACHE_DIR' => "{$this->project}/cache"],
            new BinaryDownload(self::$server->url('/assets'), $deadlineSeconds, self::$server->certificate),
            "{$this->project}/binaries.json",
            new PosixCacheSafety(new TrustedAncestorFacts($this->project)),
        );
    }

    private function refusal(float $deadlineSeconds = 10.0): BinaryFailure
    {
        try {
            $this->install($deadlineSeconds);
        } catch (BinaryRefusedException $refused) {
            return $refused->failure;
        }

        self::fail('The binary was not refused.');
    }

    private function assertRuns(InstalledBinary $installed): void
    {
        $marker = "{$this->project}/started";
        exec(escapeshellarg($installed->path) . ' ' . escapeshellarg($marker), $output, $exitCode);

        self::assertSame(0, $exitCode);
        self::assertFileExists($marker);
    }
}
