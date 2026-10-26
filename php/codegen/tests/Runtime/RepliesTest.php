<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\Replies;

/** An error reply carries the headers its declaration derives: the retry delay in its unit, and `no-store`. */
final class RepliesTest extends TestCase
{
    public function testARefusalWritesItsRetryDelayRoundedUpInSecondsAndForbidsStoring(): void
    {
        $reply = Replies::error(ApiContract::of(ThrottledContract::class), 'createTask', 'api.rate_limited', (object) ['retryAfterMs' => 1500]);

        self::assertSame(429, $reply->getStatusCode());
        self::assertSame('2', $reply->headers->get('Retry-After'));
        self::assertTrue($reply->headers->hasCacheControlDirective('no-store'));
    }

    public function testABareFormatAnswersANullPayloadAsNull(): void
    {
        $bare = ['absent' => 'omit', 'success' => ['item' => ['body' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []], 'headers' => []]]];

        self::assertNull(Replies::successBody($bare, 'item', null, 200, '/v1/tasks/t'));
        self::assertSame(['id' => 't'], Replies::successBody($bare, 'item', ['id' => 't'], 200, '/v1/tasks/t'));
    }

    public function testAnEnvelopeWritesThePayloadUnderItsMember(): void
    {
        $enveloped = ['absent' => 'omit', 'success' => ['item' => ['body' => ['kind' => 'object', 'members' => [
            ['name' => ['kind' => 'text', 'text' => 'data'], 'value' => ['kind' => 'slot', 'slot' => 'payload', 'path' => []]],
        ]], 'headers' => []]]];

        self::assertEquals((object) ['data' => ['id' => 't']], Replies::successBody($enveloped, 'item', ['id' => 't'], 200, '/v1/tasks/t'));
    }

    public function testAnErrorWithoutTheseDeclarationsWritesNeither(): void
    {
        $reply = Replies::error(ApiContract::of(ThrottledContract::class), 'createTask', 'api.not_found');

        self::assertFalse($reply->headers->has('Retry-After'));
        self::assertFalse($reply->headers->hasCacheControlDirective('no-store'));
    }
}
