<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Database\Eloquent\ModelNotFoundException;
use PHPUnit\Framework\TestCase;
use Seampact\Laravel\Runtime\ExceptionRoles;
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
