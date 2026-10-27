<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\FrameworkRefusal;
use Seampact\Laravel\Runtime\ExceptionRoles;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

/** The role map of native refusals: an `abort()` from a handler or an app middleware takes the role of its status. */
final class ExceptionRolesTest extends TestCase
{
    public function testAnAbortOf401403Or429TakesTheRoleOfItsStatus(): void
    {
        self::assertSame('unauthenticated', ExceptionRoles::roleOf(new HttpException(401)));
        self::assertSame('forbidden', ExceptionRoles::roleOf(new HttpException(403)));
        self::assertSame('rateLimited', ExceptionRoles::roleOf(new HttpException(429)));
        self::assertSame('serviceUnavailable', ExceptionRoles::roleOf(new HttpException(503)));
    }

    public function testTheThrottleRefusalGivesItsRetryAfterHeaderBeforeTheResponses(): void
    {
        $throttled = new ThrottleRequestsException('Too Many Attempts.', null, ['retry-after' => 30]);

        self::assertSame('30', FrameworkRefusal::retryAfterOf($throttled, new Response('', 429, ['Retry-After' => '7'])));
        self::assertNull(FrameworkRefusal::retryAfterOf(new HttpException(429), new Response('', 429)));
    }

    public function testAMissingModelAndAnAbortOf404TakeTheNotFoundRole(): void
    {
        self::assertSame('notFound', ExceptionRoles::roleOf(new ModelNotFoundException()));
        self::assertSame('notFound', ExceptionRoles::roleOf(new HttpException(404)));
    }

    public function testAnAbortOfAnotherStatusHasNoRole(): void
    {
        self::assertNull(ExceptionRoles::roleOf(new HttpException(418)));
        self::assertNull(ExceptionRoles::roleOf(new \RuntimeException('not an http exception')));
    }
}
