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

    public function testAnErrorWithoutTheseDeclarationsWritesNeither(): void
    {
        $reply = Replies::error(ApiContract::of(ThrottledContract::class), 'createTask', 'api.not_found');

        self::assertFalse($reply->headers->has('Retry-After'));
        self::assertFalse($reply->headers->hasCacheControlDirective('no-store'));
    }
}
