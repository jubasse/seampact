<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\BodyReader;
use Seampact\Codegen\Tests\Support\Compressed;
use Symfony\Component\HttpFoundation\Request;

/** The bounded body read: the limit counts the received bytes and the decoded ones, and a coding the boundary cannot decode is refused. */
final class BodyReaderTest extends TestCase
{
    private const LIMIT_BYTES = 1024;
    private const BODY = '{"title":"write the tests"}';

    public function testAnIdentityBodyIsReadAsReceived(): void
    {
        $read = BodyReader::read(self::request(self::BODY), self::LIMIT_BYTES);

        self::assertNull($read->refusedRole);
        self::assertSame(self::BODY, $read->bytes);
    }

    public function testABodyWithoutAContentEncodingHeaderIsReadAsIdentity(): void
    {
        $read = BodyReader::read(self::request(self::BODY, ''), self::LIMIT_BYTES);

        self::assertSame(self::BODY, $read->bytes);
    }

    /** @return iterable<string, array{string, string}> */
    public static function encodedBodies(): iterable
    {
        yield 'gzip' => ['gzip', Compressed::gzip(self::BODY)];
        yield 'x-gzip' => ['x-gzip', Compressed::gzip(self::BODY)];
        yield 'gzip in capitals with spaces' => ['  GZip ', Compressed::gzip(self::BODY)];
        yield 'deflate' => ['deflate', Compressed::deflate(self::BODY)];
    }

    #[DataProvider('encodedBodies')]
    public function testAGzipOrDeflateBodyIsDecoded(string $encoding, string $encoded): void
    {
        $read = BodyReader::read(self::request($encoded, $encoding), self::LIMIT_BYTES);

        self::assertNull($read->refusedRole);
        self::assertSame(self::BODY, $read->bytes);
    }

    /** @return iterable<string, array{string, string}> */
    public static function bodiesThatInflatePastTheLimit(): iterable
    {
        $bomb = str_repeat('0', 10 * self::LIMIT_BYTES);

        yield 'gzip' => ['gzip', Compressed::gzip($bomb)];
        yield 'deflate' => ['deflate', Compressed::deflate($bomb)];
    }

    #[DataProvider('bodiesThatInflatePastTheLimit')]
    public function testABodyThatIsSmallEncodedButPastTheLimitOnceInflatedIsTooLarge(string $encoding, string $encoded): void
    {
        self::assertLessThan(self::LIMIT_BYTES, strlen($encoded));

        $read = BodyReader::read(self::request($encoded, $encoding), self::LIMIT_BYTES);

        self::assertSame(BodyReader::TOO_LARGE, $read->refusedRole);
        self::assertSame('', $read->bytes);
    }

    public function testADeclaredContentLengthAboveTheLimitIsRefusedBeforeReading(): void
    {
        $request = self::request(self::BODY);
        $request->headers->set('Content-Length', (string) (self::LIMIT_BYTES + 1));

        self::assertSame(BodyReader::TOO_LARGE, BodyReader::read($request, self::LIMIT_BYTES)->refusedRole);
    }

    public function testAnIdentityBodyPastTheLimitWithoutAContentLengthIsTooLarge(): void
    {
        $request = self::request(str_repeat('a', self::LIMIT_BYTES + 1));
        $request->headers->remove('Content-Length');

        self::assertSame(BodyReader::TOO_LARGE, BodyReader::read($request, self::LIMIT_BYTES)->refusedRole);
    }

    public function testABodyOfExactlyTheLimitIsAccepted(): void
    {
        $read = BodyReader::read(self::request(str_repeat('a', self::LIMIT_BYTES)), self::LIMIT_BYTES);

        self::assertNull($read->refusedRole);
        self::assertSame(self::LIMIT_BYTES, strlen($read->bytes));
    }

    /** @return iterable<string, array{string, string}> */
    public static function corruptStreams(): iterable
    {
        yield 'gzip header on garbage' => ['gzip', "\x1f\x8b\x08\x00garbage-garbage-garbage"];
        yield 'plain text as gzip' => ['gzip', 'not compressed at all'];
        yield 'plain text as deflate' => ['deflate', 'not compressed at all'];
        yield 'gzip body sent as deflate' => ['deflate', Compressed::gzip(self::BODY)];
        yield 'gzip cut before its trailer' => ['gzip', substr(Compressed::gzip(self::BODY), 0, -8)];
        yield 'deflate cut before its checksum' => ['deflate', substr(Compressed::deflate(self::BODY), 0, -4)];
    }

    #[DataProvider('corruptStreams')]
    public function testACorruptStreamIsRefusedAsInvalid(string $encoding, string $encoded): void
    {
        self::assertSame(BodyReader::CORRUPT, BodyReader::read(self::request($encoded, $encoding), self::LIMIT_BYTES)->refusedRole);
    }

    /** @return iterable<string, array{string}> */
    public static function unknownEncodings(): iterable
    {
        yield 'brotli' => ['br'];
        yield 'compress' => ['compress'];
        yield 'zstd' => ['zstd'];
        yield 'a stack of codings' => ['gzip, deflate'];
        yield 'gibberish' => ['rot13'];
    }

    #[DataProvider('unknownEncodings')]
    public function testAContentEncodingTheBoundaryCannotDecodeIsUnsupported(string $encoding): void
    {
        $read = BodyReader::read(self::request(self::BODY, $encoding), self::LIMIT_BYTES);

        self::assertSame(BodyReader::UNSUPPORTED_ENCODING, $read->refusedRole);
    }

    public function testAnEmptyBodyUnderACodingIsStillEmpty(): void
    {
        $read = BodyReader::read(self::request('', 'gzip'), self::LIMIT_BYTES);

        self::assertNull($read->refusedRole);
        self::assertSame('', $read->bytes);
    }

    public function testTheAppStillReadsTheBodyAsReceivedAfterADecodedRead(): void
    {
        $encoded = Compressed::gzip(self::BODY);
        $request = self::request($encoded, 'gzip');

        BodyReader::read($request, self::LIMIT_BYTES);

        self::assertSame($encoded, $request->getContent());
    }

    private static function request(string $body, string $encoding = 'identity'): Request
    {
        $request = Request::create('/v1/tasks', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], $body);
        if ($encoding !== '') {
            $request->headers->set('Content-Encoding', $encoding);
        }

        return $request;
    }
}
