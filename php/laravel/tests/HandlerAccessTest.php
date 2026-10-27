<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Container\Container;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractBypassedException;
use Seampact\Codegen\Runtime\HandlerAccess;
use Seampact\Golden\TasksConsistent\GetChannelRequest;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
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
        self::assertNull(HandlerAccess::principal(self::admittedState(null, null), UserPrincipal::class));
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
