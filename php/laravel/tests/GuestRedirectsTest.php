<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Middleware\Authenticate;
use Illuminate\Container\Container;
use Illuminate\Contracts\Auth\Factory;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\AuthenticateSession;
use PHPUnit\Framework\TestCase;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\ApiContract;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\GuestRedirects;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Hooks;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Hooks\RequestView;
use Symfony\Component\Routing\Exception\RouteNotFoundException;

/** Laravel's `auth` and `auth.session` middleware in an app with no `login` route: a contract request gets no guest redirect, others keep the app's. */
final class GuestRedirectsTest extends TestCase
{
    private const APP_LOGIN = '/app-login';

    protected function tearDown(): void
    {
        Authenticate::redirectUsing(static fn (): ?string => null);
        AuthenticateSession::redirectUsing(static fn (): ?string => null);
    }

    public function testAContractRequestSkipsTheDefaultLoginRedirectThatWouldThrow(): void
    {
        Authenticate::redirectUsing(static fn (): string => throw new RouteNotFoundException('Route [login] not defined.'));
        GuestRedirects::skipOnContractRequests('tasks');

        self::assertNull(self::redirectOf(self::contractRequest()));
    }

    public function testAnotherRequestKeepsTheAppsRedirect(): void
    {
        Authenticate::redirectUsing(static fn (): string => self::APP_LOGIN);
        GuestRedirects::skipOnContractRequests('tasks');
        GuestRedirects::skipOnContractRequests('tasks');

        self::assertSame(self::APP_LOGIN, self::redirectOf(Request::create('/elsewhere')));
        self::assertNull(self::redirectOf(self::contractRequest()));
    }

    public function testAContractRequestSkipsTheSessionMiddlewaresLoginRedirectToo(): void
    {
        AuthenticateSession::redirectUsing(static fn (): string => throw new RouteNotFoundException('Route [login] not defined.'));
        GuestRedirects::skipOnContractRequests('tasks');

        self::assertNull(self::sessionRedirectOf(self::contractRequest()));
    }

    public function testAnotherRequestKeepsTheAppsSessionRedirect(): void
    {
        AuthenticateSession::redirectUsing(static fn (): string => self::APP_LOGIN);
        GuestRedirects::skipOnContractRequests('tasks');

        self::assertSame(self::APP_LOGIN, self::sessionRedirectOf(Request::create('/elsewhere')));
    }

    private static function contractRequest(): Request
    {
        $request = Request::create('/v1/tasks');
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'listTasks', [], new RequestView('GET', '/v1/tasks', []), new Hooks(new Container()));
        $request->attributes->set(BoundaryState::attributeName('tasks'), $state);

        return $request;
    }

    private static function redirectOf(Request $request): ?string
    {
        $middleware = new class (self::createStub(Factory::class)) extends Authenticate {
            public function guestRedirect(Request $request): ?string
            {
                return $this->redirectTo($request);
            }
        };

        return $middleware->guestRedirect($request);
    }

    private static function sessionRedirectOf(Request $request): ?string
    {
        $middleware = new class (self::createStub(Factory::class)) extends AuthenticateSession {
            public function guestRedirect(Request $request): ?string
            {
                return $this->redirectTo($request);
            }
        };

        return $middleware->guestRedirect($request);
    }
}
