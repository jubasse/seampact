<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Bundle;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Bundle\BundleFailure;
use Seampact\Ir\Bundle\BundleFetcher;
use Seampact\Ir\Bundle\FetchedBundle;
use Seampact\Ir\Bundle\GitFetch;
use Seampact\Ir\Bundle\RegistrySource;
use Seampact\Ir\Bundle\ReleaseFetch;
use Seampact\Ir\Bundle\ReleaseSource;
use Seampact\Ir\Config\LocalSourcePolicy;
use Seampact\Ir\Tests\Support\TemporaryDirectory;
use Seampact\Ir\Tests\Support\TlsServer;
use Seampact\Ir\Tests\Support\ValidBundle;

/** The release channel over real TLS: https only, verified, bounded redirects, a deadline, and the cache by integrity. */
final class ReleaseFetchTest extends TestCase
{
    private static TlsServer $server;

    public static function setUpBeforeClass(): void
    {
        self::$server = TlsServer::start(ValidBundle::tarball());
    }

    public static function tearDownAfterClass(): void
    {
        self::$server->stop();
    }

    public function testDownloadsTheTarballDirectlyAndThroughARedirect(): void
    {
        self::assertSame(ValidBundle::tarball(), $this->download('/bundle.tgz'));
        self::assertSame(ValidBundle::tarball(), $this->download('/hop'));
    }

    public function testRefusesWhatTheReleaseChannelRefuses(): void
    {
        self::assertStringContainsString("which is not an https: URL", $this->failure('/to-http')->message);
        self::assertStringContainsString('redirected more than 5 times', $this->failure('/loop')->message);
        self::assertStringContainsString('answered HTTP 404', $this->failure('/missing')->message);
        self::assertStringContainsString('took over 1000 ms', $this->failure('/slow', 1.0)->message);
        self::assertSame('bundle.release-failed', $this->failure('/missing')->code->value);
    }

    public function testNeverTrustsACertificateTheCertificateAuthoritiesDoNotSign(): void
    {
        $download = (new ReleaseFetch())->download(new ReleaseSource(self::$server->url('/bundle.tgz'), null));

        self::assertInstanceOf(BundleFailure::class, $download);
        self::assertSame('bundle.release-failed', $download->code->value);
        self::assertStringContainsString('certificate verify failed', $download->message);
    }

    public function testRefusesAUrlThatIsNotHttpsBeforeAnyRequestAndHidesItsCredentials(): void
    {
        $download = (new ReleaseFetch())->download(new ReleaseSource('http://user:secret@example.test/b.tgz?token=x', null));

        self::assertInstanceOf(BundleFailure::class, $download);
        self::assertSame('bundle.release-url', $download->code->value);
        self::assertStringNotContainsString('secret', $download->message);
        self::assertStringNotContainsString('token', $download->message);
    }

    public function testChecksTheBundleCachesItByIntegrityAndRefusesAChangedCacheEntry(): void
    {
        $cache = TemporaryDirectory::create('seampact-cache-');

        try {
            $fetcher = new BundleFetcher($cache, new ReleaseFetch(5.0, self::$server->certificate), new GitFetch([]));
            $source = new ReleaseSource(self::$server->url('/bundle.tgz'), ValidBundle::integrity());

            $fetched = $fetcher->fetch($source, $cache, LocalSourcePolicy::Allow);
            self::assertInstanceOf(FetchedBundle::class, $fetched);
            self::assertSame(['t'], array_keys($fetched->irDocuments));

            $entries = glob("{$cache}/bundles/sha256-*") ?: [];
            self::assertCount(1, $entries);
            file_put_contents("{$entries[0]}/ir/t.json", '{}');

            $refused = $fetcher->fetch(new ReleaseSource('https://127.0.0.1:1/unreachable.tgz', ValidBundle::integrity()), $cache, LocalSourcePolicy::Allow);
            self::assertIsArray($refused);
            self::assertSame('bundle.cache-invalid', $refused[0]->code->value);
        } finally {
            TemporaryDirectory::remove($cache);
        }
    }

    public function testRefusesARegistrySourceByName(): void
    {
        $fetcher = new BundleFetcher(sys_get_temp_dir(), new ReleaseFetch(), new GitFetch([]));
        $source = new RegistrySource(RegistrySource::MAVEN, 'g:a:1.0.0', null);

        $refused = $fetcher->fetch($source, sys_get_temp_dir(), LocalSourcePolicy::Allow);

        self::assertIsArray($refused);
        self::assertSame('bundle.maven-jvm-only', $refused[0]->code->value);
    }

    private function download(string $path): string
    {
        $download = (new ReleaseFetch(5.0, self::$server->certificate))->download(new ReleaseSource(self::$server->url($path), null));
        self::assertIsString($download, $download instanceof BundleFailure ? $download->message : '');

        return $download;
    }

    private function failure(string $path, float $deadline = 5.0): BundleFailure
    {
        $download = (new ReleaseFetch($deadline, self::$server->certificate))->download(new ReleaseSource(self::$server->url($path), null));
        self::assertInstanceOf(BundleFailure::class, $download);

        return $download;
    }
}
