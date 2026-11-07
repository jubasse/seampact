<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\AccessSteps;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Codegen\Runtime\HandlerAccess;
use Seampact\Codegen\Runtime\ScopeResolver;
use Seampact\Golden\TasksConsistent\GetChannelInput;
use Seampact\Golden\TasksConsistent\GetChannelPath;
use Seampact\Golden\TasksConsistent\GetChannelRequest;
use Seampact\Golden\TasksConsistent\GetChannelScopes;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Golden\TasksConsistent\ListTasksRequest;
use Seampact\Hooks\ResolveScopeRequest;
use Seampact\Hooks\ScopeResolution;
use Seampact\Hooks\RequestView;
use Seampact\Hooks\ResolvedScope;
use Seampact\Laravel\Runtime\Hooks;

/** A handler reads who is calling from its FormRequest: the principal and the scopes its api's boundary resolved. */
final class HandlerAccessTest extends TestCase
{
    private const API = 'tasks';
    private const CHANNEL_ID = '0b9a7d1e-5c1f-4d8e-9a33-2f1c6b8e4d10';

    public function testTheHandlerReadsItsPrincipalInTheGeneratedClassAndItsScope(): void
    {
        $channel = new \stdClass();
        $request = self::requestHolding(self::API, self::admittedState(new PrivatePrincipal('alice'), $channel));

        self::assertEquals(new UserPrincipal('alice'), $request->principal());
        self::assertSame(self::CHANNEL_ID, $request->scopes()->channel()->id);
        self::assertSame($channel, $request->scopes()->channel()->value);
    }

    public function testAnAnonymousCallerHasANullPrincipal(): void
    {
        self::assertNull(HandlerAccess::principal(self::admittedState(null, null), 'getChannel', UserPrincipal::class));
    }

    public function testEachApiReadsItsOwnState(): void
    {
        $request = self::requestHolding('tasksService', self::admittedState(new UserPrincipal('service'), null));

        $this->expectException(ContractBypassedException::class);
        $request->principal();
    }

    public function testAccessIsNotReadBeforeTheBoundaryAdmittedTheRequest(): void
    {
        $state = self::admittedState(new UserPrincipal('alice'), null);
        $state->admitted = false;

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('before the boundary');
        self::requestHolding(self::API, $state)->principal();
    }

    public function testAFormRequestDoesNotReadTheStateOfAnotherOperation(): void
    {
        $request = ListTasksRequest::create('/v1/tasks');
        $request->attributes->set(BoundaryState::attributeName(self::API), self::admittedState(new UserPrincipal('alice'), null));

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("operation 'listTasks' read the boundary state of operation 'getChannel'");
        $request->principal();
    }

    public function testATestBuildsTheRequestOfADirectHandlerCallWithItsInputCallerAndScopes(): void
    {
        $input = new GetChannelInput(new GetChannelPath(self::CHANNEL_ID));
        $channel = new ResolvedScope('channel', self::CHANNEL_ID, new \stdClass());

        $request = GetChannelRequest::forTest($input, new UserPrincipal('alice'), new GetChannelScopes($channel));

        self::assertSame($input, $request->contractInput());
        self::assertEquals(new UserPrincipal('alice'), $request->principal());
        self::assertSame($channel, $request->scopes()->channel());
    }

    public function testTheRequestOfADirectHandlerCallIsNeverServed(): void
    {
        $request = GetChannelRequest::forTest(new GetChannelInput(new GetChannelPath(self::CHANNEL_ID)), new UserPrincipal('alice'), new GetChannelScopes(new ResolvedScope('channel', self::CHANNEL_ID)));

        $this->expectException(ContractBypassedException::class);
        $request->authorize();
    }

    public function testJsonEncodingTheFormRequestShowsNeitherThePrincipalNorTheScopes(): void
    {
        $request = self::requestHolding(self::API, self::admittedState(new UserPrincipal('alice-secret-id'), (object) ['name' => 'channel-secret']));

        $encoded = json_encode($request, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('alice-secret-id', $encoded);
        self::assertStringNotContainsString('channel-secret', $encoded);
    }

    public function testAResolverAnsweringAnotherScopeIsRefusedWhileTheBoundaryResolves(): void
    {
        $resolver = new class () implements ScopeResolver {
            public function scope(): string
            {
                return 'channel';
            }

            public function resolveScope(ResolveScopeRequest $request): ScopeResolution
            {
                return new ScopeResolution\Resolved(new ResolvedScope('workspace', 'w-1'));
            }
        };
        $container = new Container();
        $container->instance('channelResolver', $resolver);
        $container->tag('channelResolver', Hooks::scopeResolversTag(self::API));
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'getChannel', ['channelId' => self::CHANNEL_ID], new RequestView('GET', '/v1/channels/' . self::CHANNEL_ID, []), new Hooks($container));
        $state->principal = new UserPrincipal('alice');

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage("answered the scope 'workspace' for the scope 'channel'");
        AccessSteps::resolveScopes($state);
    }

    private static function admittedState(?object $principal, ?object $channel): BoundaryState
    {
        $state = new BoundaryState(ApiContract::of(TasksContract::class), 'getChannel', ['channelId' => self::CHANNEL_ID], new RequestView('GET', '/v1/channels/' . self::CHANNEL_ID, []), new Hooks(new Container()));
        $state->principal = $principal;
        $state->scopes = [new ResolvedScope('channel', self::CHANNEL_ID, $channel)];
        $state->admitted = true;

        return $state;
    }

    private static function requestHolding(string $api, BoundaryState $state): GetChannelRequest
    {
        $request = GetChannelRequest::create('/v1/channels/' . self::CHANNEL_ID);
        $request->attributes->set(BoundaryState::attributeName($api), $state);

        return $request;
    }
}
