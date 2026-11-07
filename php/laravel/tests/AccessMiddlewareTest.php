<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryFailure;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Tests\Support\AccessContract;
use Seampact\Codegen\Tests\Support\AccessPrincipal;
use Seampact\Codegen\Tests\Support\ScriptedHooks;
use Seampact\Hooks\AuthenticateResult;
use Seampact\Hooks\Decision;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Seampact\Hooks\ScopeResolution;
use Seampact\Laravel\Runtime\AccessMiddleware;
use Seampact\Laravel\Runtime\BoundaryMark;

/** The access step of a Laravel route: a hook that throws never admits the request, and only a boundary refusal or a framework denial keeps its role. */
final class AccessMiddlewareTest extends TestCase
{
    public function testAnAdmittedRequestIsMarkedAndReachesTheNextHandler(): void
    {
        $state = self::state(self::hooks());
        $request = self::request($state);

        $reached = self::middleware()->handle($request, static fn (): string => 'next');

        self::assertSame('next', $reached);
        self::assertTrue($state->admitted);
        self::assertSame('getTask', $request->attributes->get(BoundaryMark::attributeName('tasks')));
    }

    public function testAThrowingAuthenticateHookIsABoundaryFailureAndNeverAdmits(): void
    {
        self::assertNotAdmitted(self::hooks(authenticate: static fn () => throw new \RuntimeException('auth backend down')));
    }

    public function testAThrowingScopeResolverIsABoundaryFailureAndNeverAdmits(): void
    {
        self::assertNotAdmitted(self::hooks(resolveScope: static fn () => throw new \RuntimeException('scope backend down')));
    }

    public function testAThrowingDeciderIsABoundaryFailureAndNeverAdmits(): void
    {
        self::assertNotAdmitted(self::hooks(decide: static fn () => throw new \RuntimeException('policy backend down')));
    }

    public function testAFrameworkAuthorizationDenialKeepsItsRoleInsteadOfBecomingAFailure(): void
    {
        $state = self::state(self::hooks(authenticate: static fn () => throw new AuthorizationException('no')));

        $this->expectException(AuthorizationException::class);
        self::middleware()->handle(self::request($state), static fn (): string => 'next');
    }

    public function testABoundaryRefusalPassesThroughWithItsCode(): void
    {
        $state = self::state(self::hooks(decide: static fn () => new Decision\Denied(new \Seampact\Codegen\Runtime\Denial('tasks.not_owner'))));

        try {
            self::middleware()->handle(self::request($state), static fn (): string => 'next');
            self::fail('The middleware admitted a denied request.');
        } catch (ContractRefusal $refusal) {
            self::assertSame('tasks.not_owner', $refusal->contractCode);
            self::assertFalse($state->admitted);
        }
    }

    public function testARouteOtherThanTheContractsAnswersNotFoundBeforeAnyHookRuns(): void
    {
        $ran = false;
        $state = self::state(self::hooks(authenticate: static function () use (&$ran): never {
            $ran = true;

            throw new \LogicException('must not run');
        }));
        $request = self::request($state, 'app.other-route');

        try {
            self::middleware()->handle($request, static fn (): string => 'next');
            self::fail('The middleware admitted a request on another route.');
        } catch (\Throwable $thrown) {
            self::assertInstanceOf(\LogicException::class, $thrown, 'The api declares no notFound code on this operation.');
            self::assertStringContainsString("'notFound'", $thrown->getMessage());
            self::assertFalse($ran);
        }
    }

    private static function assertNotAdmitted(ScriptedHooks $hooks): void
    {
        $state = self::state($hooks);

        try {
            self::middleware()->handle(self::request($state), static fn (): string => 'next');
            self::fail('The middleware admitted a request whose hook threw.');
        } catch (BoundaryFailure $failure) {
            self::assertInstanceOf(\RuntimeException::class, $failure->getPrevious());
            self::assertFalse($state->admitted);
        }
    }

    private static function middleware(): AccessMiddleware
    {
        return new class (self::application()) extends AccessMiddleware {
            protected function contractClass(): string
            {
                return AccessContract::class;
            }
        };
    }

    private static function application(): Application
    {
        return (new self('stub'))->createStub(Application::class);
    }

    private static function request(BoundaryState $state, string $routeName = 'seampact.tasks.getTask'): Request
    {
        $request = Request::create('/v1/channels/7/tasks/1');
        $request->headers->set('Authorization', 'Bearer token');
        $request->attributes->set(BoundaryState::attributeName('tasks'), $state);
        $route = (new Route(['GET'], '/v1/channels/{channelId}/tasks/1', static fn (): string => 'handler'))->name($routeName);
        $request->setRouteResolver(static fn (): Route => $route);

        return $request;
    }

    private static function state(ScriptedHooks $hooks): BoundaryState
    {
        return new BoundaryState(ApiContract::of(AccessContract::class), 'getTask', ['channelId' => '7'], new RequestView('GET', '/v1/channels/7/tasks/1', []), $hooks);
    }

    private static function hooks(?\Closure $authenticate = null, ?\Closure $resolveScope = null, ?\Closure $decide = null): ScriptedHooks
    {
        return new ScriptedHooks(
            $authenticate ?? static fn (): AuthenticateResult => new AuthenticateResult\Authenticated(new class implements AccessPrincipal {
                public function userId(): string
                {
                    return 'user-1';
                }
            }),
            $resolveScope ?? static fn (): ScopeResolution => new ScopeResolution\Resolved(new ResolvedScope('channel', 7)),
            $decide ?? static fn (): Decision => new Decision\Allowed(),
        );
    }
}
