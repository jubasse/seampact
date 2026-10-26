<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Symfony\Runtime\ExceptionRoles;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\UnauthorizedHttpException;

/** The role map of native refusals: an HTTP exception from a handler or an app listener takes the role of its status. */
final class ExceptionRolesTest extends TestCase
{
    public function testAnHttpExceptionOf401403Or429TakesTheRoleOfItsStatus(): void
    {
        $written = new Response('', 500);

        self::assertSame('unauthenticated', ExceptionRoles::roleOf(new UnauthorizedHttpException('Bearer'), $written));
        self::assertSame('forbidden', ExceptionRoles::roleOf(new AccessDeniedHttpException(), $written));
        self::assertSame('rateLimited', ExceptionRoles::roleOf(new HttpException(429), $written));
    }

    public function testAnHttpExceptionOf401403Or429IsANativeRefusal(): void
    {
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(401)));
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(403)));
        self::assertTrue(ExceptionRoles::isNativeRefusal(new HttpException(429)));
    }

    public function testAnHttpExceptionOfAnotherStatusHasNoRole(): void
    {
        self::assertNull(ExceptionRoles::roleOf(new HttpException(418), new Response('', 418)));
        self::assertNull(ExceptionRoles::roleOf(new HttpException(503), new Response('', 503)));
        self::assertFalse(ExceptionRoles::isNativeRefusal(new HttpException(404)));
        self::assertNull(ExceptionRoles::roleOf(new \RuntimeException('not an http exception'), new Response('', 500)));
    }
}
