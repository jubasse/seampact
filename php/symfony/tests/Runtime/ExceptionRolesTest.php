<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Symfony\Runtime\ExceptionRoles;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Symfony\Component\HttpKernel\Exception\UnauthorizedHttpException;

/** The role map of native refusals: an HTTP exception from a handler or an app listener takes the role of its status. */
final class ExceptionRolesTest extends TestCase
{
    public function testTheTooManyRequestsExceptionGivesItsRetryAfterHeader(): void
    {
        self::assertSame(['30'], ExceptionRoles::retryAfterValues(new TooManyRequestsHttpException(30), new Response('', 429)));
        self::assertSame(['Wed, 21 Oct 2026 07:28:00 GMT'], ExceptionRoles::retryAfterValues(new TooManyRequestsHttpException('Wed, 21 Oct 2026 07:28:00 GMT'), new Response('', 429)));
    }

    // Shaped like RateLimiter's `RateLimitExceededException`: no HTTP status or headers, a delay through `getRetryAfter()`.
    public function testTheRateLimitersDelayComesBeforeTheResponsesRetryAfter(): void
    {
        $exceeded = new class extends \RuntimeException {
            public function getRetryAfter(): \DateTimeImmutable
            {
                return new \DateTimeImmutable('+30 seconds');
            }
        };

        self::assertSame(['30', '7'], ExceptionRoles::retryAfterValues($exceeded, new Response('', 500, ['Retry-After' => '7'])));
    }

    public function testAnHttpExceptionOf401403404429Or503TakesTheRoleOfItsStatus(): void
    {
        $written = new Response('', 500);

        self::assertSame('unauthenticated', ExceptionRoles::roleOf(new UnauthorizedHttpException('Bearer'), $written));
        self::assertSame('forbidden', ExceptionRoles::roleOf(new AccessDeniedHttpException(), $written));
        self::assertSame('rateLimited', ExceptionRoles::roleOf(new HttpException(429), $written));
        self::assertSame('notFound', ExceptionRoles::roleOf(new NotFoundHttpException(), $written));
        self::assertSame('serviceUnavailable', ExceptionRoles::roleOf(new HttpException(503), $written));
    }

    public function testEveryHttpExceptionIsANativeRefusalThatTheStatusRuleMaps(): void
    {
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(401)));
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(404)));
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(418)));
        self::assertFalse(ExceptionRoles::isNativeRefusal(new \RuntimeException('not an http exception')));
    }

    public function testAnHttpExceptionOfAnotherStatusHasNoRole(): void
    {
        self::assertNull(ExceptionRoles::roleOf(new HttpException(418), new Response('', 418)));
        self::assertNull(ExceptionRoles::roleOf(new \RuntimeException('not an http exception'), new Response('', 500)));
    }
}
