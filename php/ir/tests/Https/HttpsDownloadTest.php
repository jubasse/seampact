<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Https;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Https\HttpsDownload;
use Seampact\Ir\Https\HttpsFailure;
use Seampact\Ir\Tests\Support\TlsServer;
use Seampact\Ir\Tests\Support\ValidBundle;

/** What the hand-written HTTPS client refuses, by name, against a real TLS server with verification on. */
final class HttpsDownloadTest extends TestCase
{
    private const BYTES_MAX = 1_000_000;

    private static TlsServer $server;

    public static function setUpBeforeClass(): void
    {
        self::$server = TlsServer::start(ValidBundle::tarball());
    }

    public static function tearDownAfterClass(): void
    {
        self::$server->stop();
    }

    /** @return iterable<string, array{string, string}> */
    public static function refusals(): iterable
    {
        yield 'a chunked body' => ['/chunked', 'answered an HTTP/1.0 request with a chunked body'];
        yield 'a bad Content-Length' => ['/bad-length/', 'sent an unreadable Content-Length'];
        yield 'headers over 65536 bytes' => ['/big-header/', 'sent headers over 65536 bytes'];
        yield 'two Location headers' => ['/two-locations', 'answered a redirect with more than one Location header'];
        yield 'a redirect with user info' => ['/user-info', 'which holds a user name or password'];
    }

    #[DataProvider('refusals')]
    public function testRefusesByName(string $path, string $reason): void
    {
        $failure = $this->stream(self::$server->url($path));

        self::assertNotNull($failure);
        self::assertStringContainsString($reason, $failure->reason);
        self::assertStringNotContainsString('secret', $failure->reason);
    }

    public function testRefusesACertificateMadeForAnotherHostName(): void
    {
        $failure = $this->stream("https://localhost:" . self::$server->port . '/bundle.tgz');

        self::assertNotNull($failure);
        self::assertStringContainsString('did not match', $failure->reason);
    }

    private function stream(string $url): ?HttpsFailure
    {
        return (new HttpsDownload(5.0, self::$server->certificate))->stream($url, self::BYTES_MAX, static function (string $chunk): void {
        });
    }
}
