<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests\Https;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Ir\Https\HttpsFailure;
use Seampact\Ir\Https\HttpsHead;

final class HttpsHeadTest extends TestCase
{
    public function testReadsTheStatusTheLocationsTheLengthAndTheChunking(): void
    {
        $head = HttpsHead::parse('https://x.test/a', "HTTP/1.1 302 Found\r\nLocation: /a\r\nlocation: /b\r\ncontent-length: 12\r\nTransfer-Encoding: Chunked", 'body');

        self::assertInstanceOf(HttpsHead::class, $head);
        self::assertSame(302, $head->status);
        self::assertSame(['/a', '/b'], $head->locations);
        self::assertSame(12, $head->contentLength);
        self::assertTrue($head->chunked);
        self::assertSame('body', $head->bodyStart);
    }

    public function testAcceptsTheSameLengthTwiceAndNoLength(): void
    {
        $twice = HttpsHead::parse('https://x.test/a', "HTTP/1.0 200 OK\r\nContent-Length: 5\r\nContent-Length: 5", '');
        $none = HttpsHead::parse('https://x.test/a', 'HTTP/1.0 200 OK', '');

        self::assertInstanceOf(HttpsHead::class, $twice);
        self::assertSame(5, $twice->contentLength);
        self::assertInstanceOf(HttpsHead::class, $none);
        self::assertNull($none->contentLength);
        self::assertSame([], $none->locations);
        self::assertFalse($none->chunked);
    }

    /** @return iterable<string, array{string, string}> */
    public static function refusedHeads(): iterable
    {
        yield 'no status line' => ['garbage', 'answered with no HTTP status line'];
        yield 'a length that is not a number' => ["HTTP/1.1 200 OK\r\nContent-Length: abc", 'sent an unreadable Content-Length'];
        yield 'a negative length' => ["HTTP/1.1 200 OK\r\nContent-Length: -1", 'sent an unreadable Content-Length'];
        yield 'two different lengths' => ["HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6", 'sent an unreadable Content-Length'];
        yield 'a length of 19 digits' => ["HTTP/1.1 200 OK\r\nContent-Length: 1234567890123456789", 'sent an unreadable Content-Length'];
    }

    #[DataProvider('refusedHeads')]
    public function testRefusesAHeadByName(string $head, string $reason): void
    {
        $parsed = HttpsHead::parse('https://x.test/a', $head, '');

        self::assertInstanceOf(HttpsFailure::class, $parsed);
        self::assertSame($reason, $parsed->reason);
    }
}
