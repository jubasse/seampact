<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\Replies;
use Seampact\Codegen\Runtime\ResponseHeaders;
use Seampact\Codegen\Tests\Support\LegacyNoteReply;
use Seampact\Codegen\Tests\Support\UpdatedNoteReply;
use Seampact\Codegen\Tests\Support\VersionedNotesContract;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * A success writes the headers its response derives: a deprecated operation's Deprecation, Sunset and successor Link,
 * and the version ETag of an item versioned by `If-Match`, which `cache.etag` uses too.
 */
final class ResponseHeadersTest extends TestCase
{
    // The note id `a b/é`, as the request path carries it.
    private const ENCODED_NOTE_ID = 'a%20b%2F%C3%A9';

    public function testADeprecatedReadWritesItsDeprecationSunsetAndSuccessorLink(): void
    {
        $reply = $this->replied('legacyNote', new LegacyNoteReply((object) ['revision' => 1]));

        self::assertSame(200, $reply->getStatusCode());
        self::assertSame('@1798675200', $reply->headers->get('Deprecation'));
        self::assertSame('Wed, 30 Jun 2027 00:00:00 GMT', $reply->headers->get('Sunset'));
        self::assertSame('</api/v1/notes/' . self::ENCODED_NOTE_ID . '>; rel="successor-version"', $reply->headers->get('Link'));
    }

    public function testAnEmptyDeprecatedSuccessWritesItsDeprecationHeaders(): void
    {
        $reply = $this->replied('purgeNote', new \stdClass());

        self::assertSame(204, $reply->getStatusCode());
        self::assertSame('@1798675200', $reply->headers->get('Deprecation'));
        self::assertSame('Wed, 30 Jun 2027 00:00:00 GMT', $reply->headers->get('Sunset'));
    }

    public function testAVersionedItemWritesItsVersionAsAStrongEntityTag(): void
    {
        $reply = $this->replied('updateNote', new UpdatedNoteReply((object) ['revision' => 2, 'text' => 'On time']));

        self::assertSame('"2"', $reply->headers->get('ETag'));
    }

    public function testTheCacheEtagIsTheVersionTagAndItsNotModifiedCarriesNoDeprecationHeader(): void
    {
        $reply = $this->replied('legacyNote', new LegacyNoteReply((object) ['revision' => 1]), ['If-None-Match' => 'W/"1"']);

        self::assertSame(304, $reply->getStatusCode());
        self::assertSame('"1"', $reply->headers->get('ETag'));
        self::assertFalse($reply->headers->has('Deprecation'));
        self::assertFalse($reply->headers->has('Link'));
    }

    public function testAnItemWithoutAReadableVersionIsTheHandlersMistake(): void
    {
        $this->expectException(BoundaryFailure::class);

        $this->replied('updateNote', new UpdatedNoteReply((object) ['revision' => 'with "quotes"']));
    }

    public function testAnIntegerVersionBeyondTheSafeRangeIsTheHandlersMistake(): void
    {
        $this->expectException(BoundaryFailure::class);

        $this->replied('updateNote', new UpdatedNoteReply((object) ['revision' => 9007199254740993]));
    }

    public function testThePeakSafeIntegerVersionIsWritten(): void
    {
        $reply = $this->replied('updateNote', new UpdatedNoteReply((object) ['revision' => 9007199254740991]));

        self::assertSame('"9007199254740991"', $reply->headers->get('ETag'));
    }

    public function testAPathSegmentEncodesEveryOctetOutsideUnreserved(): void
    {
        self::assertSame('a-._~%25%2F%C3%A9', ResponseHeaders::encodedPathSegment('a-._~%/é'));
    }

    /** @param array<string, string> $headers */
    private function replied(string $operationId, object $result, array $headers = []): Response
    {
        $contract = ApiContract::of(VersionedNotesContract::class);
        $request = Request::create('/api/v1/notes/' . self::ENCODED_NOTE_ID);
        foreach ($headers as $name => $value) {
            $request->headers->set($name, $value);
        }
        $state = new BoundaryState($contract, $operationId, ['noteId' => self::ENCODED_NOTE_ID], new RequestView('GET', '/api/v1/notes/' . self::ENCODED_NOTE_ID, []), $this->createStub(HookLookup::class));
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);

        return Replies::result($request, $contract->api, $result);
    }
}
